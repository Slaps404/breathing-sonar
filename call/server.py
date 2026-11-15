"""Phone alert: when breathing stops, ElevenLabs phones every friend at once through your Twilio number.

Run:   python3 call/server.py                      (listens on http://127.0.0.1:8788, the app POSTs /call)
Test:  python3 call/server.py --test +16195550123 [--name Sam] [--user Alex] [--place "the library"]

Keys come from .env in the repo root (never committed). First run sets up ElevenLabs once:
it imports your Twilio number and creates the voice agent, then saves their ids in call/state.json.
Only the Python standard library is used, so no install is needed.
"""
import json
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
STATE = Path(__file__).with_name("state.json")
API = "https://api.elevenlabs.io/v1/convai"
PORT = 8788

FIRST = ("Hi {{friend_name}}. This is an automated safety alert for {{user_name}}. "
         "Their breathing appears to have stopped{{place_phrase}}, and they did not answer a check on their laptop. "
         "Please check on them right now. If you cannot reach them, call 911. {{others_phrase}}")
PROMPT = """You are an automated safety alert calling on behalf of {{user_name}}.
A laptop breathing monitor saw their breathing stop{{place_phrase}}, and they did not press "I'm okay" on screen.
You already told {{friend_name}} this. Your only job: make sure they understood and will check on {{user_name}} now.
Facts you know: the person is {{user_name}}; the place is "{{place}}" (empty means unknown); {{others_phrase}}
Answer questions in one short sentence using only those facts. Never guess anything else (no medical advice, no
cause, no other location). If asked, say you are an automated alert and they should call 911 if they cannot reach
{{user_name}}. Once they say they will check, say thank you and end the call."""


def env():
    keys = {}
    for line in (ROOT / ".env").read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            keys[k.strip()] = v.strip()
    missing = [k for k in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_NUMBER", "ELEVENLABS_API_KEY") if not keys.get(k)]
    if missing:
        sys.exit(f"Missing in .env: {', '.join(missing)}")
    return keys


def post(keys, path, body, method="POST"):
    req = Request(API + path, json.dumps(body).encode(), method=method,
                  headers={"xi-api-key": keys["ELEVENLABS_API_KEY"], "Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=30) as r:
            return json.load(r)
    except HTTPError as err:   # ElevenLabs explains what is wrong in the body
        raise RuntimeError(f"ElevenLabs {path} said {err.code}: {err.read().decode()[:500]}") from None


def setup(keys):
    """Import the Twilio number and create the agent once; reuse their ids after that."""
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    if state.get("number") != keys["TWILIO_NUMBER"]:
        state["phone_number_id"] = post(keys, "/phone-numbers", {
            "phone_number": keys["TWILIO_NUMBER"], "label": "Sonar alerts", "provider": "twilio",
            "sid": keys["TWILIO_ACCOUNT_SID"], "token": keys["TWILIO_AUTH_TOKEN"]})["phone_number_id"]
        state["number"] = keys["TWILIO_NUMBER"]
    if "agent_id" not in state:
        state["agent_id"] = post(keys, "/agents/create", {"name": "Sonar breathing alert", "conversation_config": {
            "agent": {"first_message": FIRST, "language": "en", "prompt": {"prompt": PROMPT}}}})["agent_id"]
    if not state.get("voice_override"):   # let each call pick its voice (the app's voice setting)
        post(keys, f"/agents/{state['agent_id']}", {"platform_settings": {"overrides": {
            "conversation_config_override": {"tts": {"voice_id": True}}}}}, method="PATCH")
        state["voice_override"] = True
    STATE.write_text(json.dumps(state, indent=1))
    return state


def call_all(keys, state, friends, user_name, place, voice_id=None):
    """Ring every friend at the same time. Returns one result per friend."""
    def one(f):
        others = [g["name"] for g in friends if g is not f]
        others_phrase = ("I am also calling " + " and ".join(others) + ".") if others else ""
        try:
            r = post(keys, "/twilio/outbound-call", {
                "agent_id": state["agent_id"], "agent_phone_number_id": state["phone_number_id"], "to_number": f["phone"],
                "conversation_initiation_client_data": {"dynamic_variables": {
                    "friend_name": f["name"], "user_name": user_name, "place": place,
                    "place_phrase": f" at {place}" if place else "", "others_phrase": others_phrase},
                    **({"conversation_config_override": {"tts": {"voice_id": voice_id}}} if voice_id else {})}})
            return {"name": f["name"], "phone": f["phone"], "ok": bool(r.get("success")), "detail": r.get("message")}
        except Exception as err:
            return {"name": f["name"], "phone": f["phone"], "ok": False, "detail": str(err)}
    with ThreadPoolExecutor(len(friends)) as pool:
        return list(pool.map(one, friends))


class Handler(BaseHTTPRequestHandler):
    keys = state = None
    lock = threading.Lock()

    def reply(self, code, body):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")   # the app page may be opened as a file
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())

    def do_OPTIONS(self):
        self.reply(204, {})

    def do_POST(self):
        if self.path != "/call":
            return self.reply(404, {"error": "POST /call"})
        try:
            data = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            # {friends: [{name, phone}], userName, place}; phone in +1... form
            friends = [{"name": f["name"], "phone": f["phone"]} for f in data["friends"]]
            if not friends:
                raise ValueError("no friends to call")
        except (ValueError, KeyError, TypeError) as err:
            return self.reply(400, {"error": f"bad request: {err}"})
        voice = data.get("voiceId")
        voice = voice if isinstance(voice, str) and voice.isalnum() and len(voice) <= 40 else None
        results = call_all(self.keys, self.state, friends, data.get("userName", "your friend"), data.get("place", ""), voice)
        print("call:", [(r["name"], r["ok"], r["detail"]) for r in results], flush=True)
        self.reply(200 if any(r["ok"] for r in results) else 502, {"results": results})


def main():
    keys = env()
    state = setup(keys)
    args = sys.argv[1:]
    if args and args[0] == "--test":
        opt = dict(zip(args[2::2], args[3::2]))
        res = call_all(keys, state, [{"name": opt.get("--name", "friend"), "phone": args[1]}],
                       opt.get("--user", "your friend"), opt.get("--place", ""))
        print(json.dumps(res, indent=1))
        return
    Handler.keys, Handler.state = keys, state
    print(f"Ready: POST http://127.0.0.1:{PORT}/call", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()

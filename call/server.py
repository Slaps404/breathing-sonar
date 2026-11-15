"""Phone alert: when breathing stops, every friend gets a text with the location and an ElevenLabs call,
both from your Twilio number. The voice says the location: the typed place plus the street address of the GPS fix.

Run:   python3 call/server.py                      (listens on http://127.0.0.1:8788, the app POSTs /call)
Test:  python3 call/server.py --test +16195550123 [--name Sam] [--user Alex] [--place "the library"] [--lat 32.88 --lng -117.23]
       python3 call/server.py --where 32.8811 -117.2376 ["the library"]     (prints what the voice would say, no call)

Keys come from .env in the repo root (never committed). First run sets up ElevenLabs once:
it imports your Twilio number and creates the voice agent, then saves their ids in call/state.json.
Only the Python standard library is used, so no install is needed.
"""
import base64
import json
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
STATE = Path(__file__).with_name("state.json")
API = "https://api.elevenlabs.io/v1/convai"
GEOCODER = "https://nominatim.openstreetmap.org/reverse"   # OpenStreetMap: free, no key, coordinates in, address out
PORT = 8788

FIRST = ("Hi {{friend_name}}. This is an automated safety alert for {{user_name}}. "
         "Their breathing appears to have stopped{{place_phrase}}, and they did not answer a check on their laptop. "
         "Please check on them right now. {{text_phrase}}If you cannot reach them, call 911. {{others_phrase}}"
         "Will you check on {{user_name}} now? Please say yes so I know you heard.")
PROMPT = """You are an automated safety alert calling on behalf of {{user_name}}.
A laptop breathing monitor saw their breathing stop{{place_phrase}}, and they did not press "I'm okay" on screen.
You already told {{friend_name}} this. Your only job: make sure they understood and will check on {{user_name}} now.
Facts you know: the person is {{user_name}}; their location is "{{place}}" (empty means unknown); {{text_phrase}}{{others_phrase}}
Answer questions in one short sentence using only those facts. Never guess anything else (no medical advice, no
cause, no other location). If asked where they are, repeat that location word for word. If asked, say you are an automated alert and they should call 911 if they cannot reach
{{user_name}}. Once they say they will check, say thank you and use the end_call tool.
If you reach voicemail, a call screener, or get no answer after asking twice, repeat the alert once and use end_call.
Never say goodbye without using end_call in the same turn."""
# Off: texts are blocked (Twilio 30034) until an A2P campaign is approved. Set True once it is.
SEND_SMS = False
SMS = ("Sonar safety alert: {user}'s breathing appears to have stopped and they did not respond. "
       "Check on them now. If you cannot reach them, call 911.\nLocation: {where}")


def agent_config():
    """Agent settings, applied on every start so changes here reach the live agent."""
    return {
        "agent": {"first_message": FIRST, "language": "en", "prompt": {"prompt": PROMPT, "built_in_tools": {
            "end_call": {"name": "end_call", "description": "", "params": {"system_tool_type": "end_call"}}}}},
        "turn": {"silence_end_call_timeout": 20},       # hang up after 20 s of silence
        "conversation": {"max_duration_seconds": 120},  # hard cap, whatever happens
    }


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


def send_sms(keys, to, body):
    """Text through Twilio's REST API. Returns None on success, else the error."""
    sid = keys["TWILIO_ACCOUNT_SID"]
    auth = base64.b64encode(f"{sid}:{keys['TWILIO_AUTH_TOKEN']}".encode()).decode()
    req = Request(f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
                  urlencode({"From": keys["TWILIO_NUMBER"], "To": to, "Body": body}).encode(),
                  headers={"Authorization": "Basic " + auth})
    try:
        with urlopen(req, timeout=15):
            return None
    except HTTPError as err:
        return f"Twilio SMS said {err.code}: {err.read().decode()[:300]}"
    except Exception as err:
        return str(err)


def where(place, lat, lng):
    """Prefer coordinates for the map pin; fall back to searching the typed place."""
    query = f"{lat:.6f},{lng:.6f}" if lat is not None and lng is not None else place.strip()
    if not query:
        return "unknown"
    link = "https://www.google.com/maps/search/?" + urlencode({"api": 1, "query": query})
    return "\n".join(x for x in (place, link) if x)


def address(lat, lng):
    """Street address for a GPS fix, in words a voice can say. "" if there is no fix or the lookup fails."""
    if lat is None or lng is None:
        return ""
    url = GEOCODER + "?" + urlencode({"format": "jsonv2", "lat": f"{lat:.6f}", "lon": f"{lng:.6f}", "zoom": 18})
    try:   # short timeout: a slow lookup must not hold up the call
        with urlopen(Request(url, headers={"User-Agent": "sonar-breathing-alert"}), timeout=3) as r:
            found = json.load(r)
    except Exception as err:
        print("address lookup failed:", err, flush=True)
        return ""
    a = found.get("address") or {}
    street = " ".join(x for x in (a.get("house_number"), a.get("road")) if x)
    area = a.get("neighbourhood") or a.get("suburb")
    city = a.get("city") or a.get("town") or a.get("village")
    parts = []
    for x in (found.get("name"), street, area, city):   # building name, street, neighborhood, city
        if x and x not in parts and x != a.get("road"):
            parts.append(x)
    return ", ".join(parts)


def spoken_place(place, lat, lng):
    """What the voice says after "breathing appears to have stopped": typed place, then the GPS address.
    "near", not "at": a laptop's fix comes from Wi-Fi and can be off by a building."""
    addr = address(lat, lng)
    if place and addr:
        return f"at {place}, near {addr}"
    return f"at {place}" if place else f"near {addr}" if addr else ""


def setup(keys):
    """Import the Twilio number and create the agent once; reuse their ids after that."""
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    if state.get("number") != keys["TWILIO_NUMBER"]:
        state["phone_number_id"] = post(keys, "/phone-numbers", {
            "phone_number": keys["TWILIO_NUMBER"], "label": "Sonar alerts", "provider": "twilio",
            "sid": keys["TWILIO_ACCOUNT_SID"], "token": keys["TWILIO_AUTH_TOKEN"]})["phone_number_id"]
        state["number"] = keys["TWILIO_NUMBER"]
    if "agent_id" not in state:
        state["agent_id"] = post(keys, "/agents/create", {"name": "Sonar breathing alert",
                                                          "conversation_config": agent_config()})["agent_id"]
    else:
        post(keys, f"/agents/{state['agent_id']}", {"conversation_config": agent_config()}, method="PATCH")
    if not state.get("voice_override"):   # let each call pick its voice (the app's voice setting)
        post(keys, f"/agents/{state['agent_id']}", {"platform_settings": {"overrides": {
            "conversation_config_override": {"tts": {"voice_id": True}}}}}, method="PATCH")
        state["voice_override"] = True
    STATE.write_text(json.dumps(state, indent=1))
    return state


def call_all(keys, state, friends, user_name, place, voice_id=None, lat=None, lng=None):
    """Text then ring every friend, all friends at the same time. Returns one result per friend."""
    said = spoken_place(place.strip(), lat, lng)   # looked up once, shared by every friend's call
    print("location said on the call:", said or "(none)", flush=True)

    def one(f):
        others = [g["name"] for g in friends if g is not f]
        others_phrase = ("I am also calling " + " and ".join(others) + ".") if others else ""
        sms_err = (send_sms(keys, f["phone"], SMS.format(user=user_name, where=where(place, lat, lng)))
                   if SEND_SMS else "off (SEND_SMS = False)")
        text_phrase = "" if sms_err else "I requested a text with their location. "
        try:
            r = post(keys, "/twilio/outbound-call", {
                "agent_id": state["agent_id"], "agent_phone_number_id": state["phone_number_id"], "to_number": f["phone"],
                "conversation_initiation_client_data": {"dynamic_variables": {
                    "friend_name": f["name"], "user_name": user_name, "place": said,
                    "place_phrase": " " + said if said else "", "others_phrase": others_phrase,
                    "text_phrase": text_phrase},
                    **({"conversation_config_override": {"tts": {"voice_id": voice_id}}} if voice_id else {})}})
            return {"name": f["name"], "phone": f["phone"], "ok": bool(r.get("success")), "detail": r.get("message"),
                    "sms": sms_err or "submitted"}
        except Exception as err:
            return {"name": f["name"], "phone": f["phone"], "ok": False, "detail": str(err), "sms": sms_err or "submitted"}
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
            # {friends: [{name, phone}], userName, place, lat?, lng?}; phone in +1... form
            friends = [{"name": f["name"], "phone": f["phone"]} for f in data["friends"]]
            if not friends:
                raise ValueError("no friends to call")
        except (ValueError, KeyError, TypeError) as err:
            return self.reply(400, {"error": f"bad request: {err}"})
        voice = data.get("voiceId")
        voice = voice if isinstance(voice, str) and voice.isalnum() and len(voice) <= 40 else None
        lat, lng = data.get("lat"), data.get("lng")
        if not (isinstance(lat, (int, float)) and isinstance(lng, (int, float))):
            lat = lng = None
        results = call_all(self.keys, self.state, friends, data.get("userName", "your friend"), data.get("place", ""),
                           voice, lat, lng)
        print("call:", [(r["name"], r["ok"], r["detail"], r["sms"]) for r in results], flush=True)
        self.reply(200 if any(r["ok"] for r in results) else 502, {"results": results})


def main():
    args = sys.argv[1:]
    if args and args[0] == "--where":   # no keys needed, nothing is called
        print(spoken_place(args[3] if len(args) > 3 else "", float(args[1]), float(args[2])) or "(nothing)")
        return
    keys = env()
    state = setup(keys)
    if args and args[0] == "--test":
        opt = dict(zip(args[2::2], args[3::2]))
        gps = [float(opt[k]) if k in opt else None for k in ("--lat", "--lng")]
        res = call_all(keys, state, [{"name": opt.get("--name", "friend"), "phone": args[1]}],
                       opt.get("--user", "your friend"), opt.get("--place", ""), None, *gps)
        print(json.dumps(res, indent=1))
        return
    Handler.keys, Handler.state = keys, state
    print(f"Ready: POST http://127.0.0.1:{PORT}/call", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()

"""Phone alert: when breathing stops, every friend gets a text with the location and an ElevenLabs call,
both from your Twilio number. The voice says the location the way a friend would: "at home", or "at CVS Pharmacy on Main Street, close to their home".

Run:   python3 call/server.py                      (listens on http://127.0.0.1:8788, the app POSTs /call)
Test:  python3 call/server.py --test +16195550123 [--name Sam] [--user Alex] [--place "the library"] [--lat 32.88 --lng -117.23 --home "home address"]
       python3 call/server.py --where LAT LNG ["home address"]     (prints what the voice would say, no call)

Keys come from .env in the repo root (never committed). First run sets up ElevenLabs once:
it imports your Twilio number and creates the voice agent, then saves their ids in call/state.json.
Only the Python standard library is used, so no install is needed.

On a hosting service (so a phone can reach it): start command `python3 call/server.py`, and set these as
environment variables there instead of .env: the four keys, CALL_PASSCODE (any secret word: the app must send it,
so strangers cannot spend your Twilio credit), and SONAR_STATE (the text of your local call/state.json, so a
restart reuses the same agent). Hosts set PORT themselves: when it is set the server listens publicly on it,
and refuses to start without CALL_PASSCODE.
"""
import base64
import hmac
import json
import math
import os
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
AT_HOME_MILES = 0.06   # about 100 m: a Wi-Fi fix taken at home can land this far from the address on the map
AT_PLACE_MILES = 0.025  # about 40 m: closer than this to a named shop or building counts as being at it
GEOCODER = "https://nominatim.openstreetmap.org"   # OpenStreetMap: free, no key. /reverse: fix to address, /search: address to fix
PORT = 8788

FIRST = ("Hi {{friend_name}}. This is an automated safety alert for {{user_name}}. "
         "Their breathing appears to have stopped{{place_phrase}}, and they did not answer a check on their laptop. "
         "Please check on them right now. {{text_phrase}}If you cannot reach them, call 911. {{others_phrase}}"
         "Will you check on {{user_name}} now? Please say yes so I know you heard.")
PROMPT = """You are an automated safety alert calling on behalf of {{user_name}}.
A laptop breathing monitor saw their breathing stop{{place_phrase}}, and they did not press "I'm okay" on screen.
You already told {{friend_name}} this. Your only job: make sure they understood and will check on {{user_name}} now.
Facts you know: the person is {{user_name}}; their location is "{{place}}" and the street address from their GPS is "{{address}}" (empty means unknown); {{text_phrase}}{{others_phrase}}
Answer questions in one short sentence using only those facts. Never guess anything else (no medical advice, no
cause, no other location). If asked where they are, repeat that location, and give the street address if they ask for it. If asked, say you are an automated alert and they should call 911 if they cannot reach
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
    """Keys from .env (laptop), overridden by environment variables (hosting service, which has no .env)."""
    keys, dotenv = {}, ROOT / ".env"
    for line in (dotenv.read_text().splitlines() if dotenv.exists() else []):
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            keys[k.strip()] = v.strip()
    needed = ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_NUMBER", "ELEVENLABS_API_KEY")
    for k in needed + ("CALL_PASSCODE",):
        if os.environ.get(k):
            keys[k] = os.environ[k].strip()
    missing = [k for k in needed if not keys.get(k)]
    if missing:
        sys.exit(f"Missing in .env or the environment: {', '.join(missing)}")
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


def osm(lat, lng, layer):
    """One OpenStreetMap lookup of a GPS fix. layer "address" finds the house, "poi" the nearest shop or building."""
    return ask("/reverse", {"lat": f"{lat:.6f}", "lon": f"{lng:.6f}", "zoom": 18, "layer": layer}) or {}


def ask(path, query):
    """One OpenStreetMap request. None if it fails: the call then goes out with less detail, never later."""
    url = GEOCODER + path + "?" + urlencode({"format": "jsonv2", **query})
    try:   # short timeout: a slow lookup must not hold up the call
        with urlopen(Request(url, headers={"User-Agent": "sonar-breathing-alert"}), timeout=3) as r:
            return json.load(r)
    except Exception as err:
        print(f"{path} lookup failed:", err, flush=True)
        return None


def find_home(home_address):
    """Where the typed home address is on the map, as (lat, lng). None if it is empty or not found."""
    hits = ask("/search", {"q": home_address, "limit": 1}) if home_address else None
    if not hits:
        if home_address:
            print("home address not found on the map:", home_address, flush=True)
        return None
    return float(hits[0]["lat"]), float(hits[0]["lon"])


def lookup(lat, lng):
    """Ask OpenStreetMap what is at a GPS fix. Returns (name of the shop or building, its road and area, full street address); "" for unknowns."""
    with ThreadPoolExecutor(2) as pool:   # both questions at once, so the call waits for one lookup, not two
        house, poi = pool.map(lambda layer: osm(lat, lng, layer), ("address", "poi"))
    # The nearest named place only counts if the person is about inside it, not down the street from it.
    name = poi.get("name") or ""
    if name and miles(lat, lng, float(poi["lat"]), float(poi["lon"])) > AT_PLACE_MILES:
        name = ""
    a = (poi if name else house).get("address") or {}
    street = " ".join(x for x in (a.get("house_number"), a.get("road")) if x)
    area = [x for x in (a.get("neighbourhood") or a.get("suburb"), a.get("city") or a.get("town") or a.get("village")) if x]
    return name, ", ".join([x for x in (a.get("road"),) if x] + area), ", ".join([x for x in (street,) if x] + area)


def miles(lat1, lng1, lat2, lng2):
    """Straight-line distance between two GPS fixes (haversine formula)."""
    p1, p2, dl = math.radians(lat1), math.radians(lat2), math.radians(lng2 - lng1)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 3959 * 2 * math.asin(math.sqrt(h))


def spoken_place(place, lat, lng, home_address=""):
    """The location as a friend would say it: "at home", "at CVS Pharmacy on Main Street, close to their home".
    Returns (phrase for the alert sentence, street address the agent gives only if asked).
    place: what the person typed. lat/lng: where GPS says they are now. home_address: their typed home address,
    found on the map and compared with the GPS fix to tell "at home" from "3 miles from home"."""
    if lat is None or lng is None:
        return (f"at {place}" if place else ""), ""
    with ThreadPoolExecutor(2) as pool:   # all map questions at once, so the call waits for one lookup, not three
        here, home = pool.submit(lookup, lat, lng), pool.submit(find_home, home_address.strip())
    (name, road, addr), home = here.result(), home.result()
    far = miles(lat, lng, *home) if home else None
    if far is not None and far <= AT_HOME_MILES:   # the typed address beats the one guessed from GPS
        return (f"at home, {place}" if place else "at home"), home_address.strip()
    if place:
        spot = f"at {place}" + (f", near {addr}" if addr else "")
    elif name:
        spot = f"at {name}" + (f" on {road}" if road else "")   # house number left out: the name finds it
    else:   # "near", not "at": a laptop's fix comes from Wi-Fi and can be off by a building
        spot = f"near {addr}" if addr else ""
    if far is not None and far <= 20:   # further than that, home is no help in finding them
        spot += ", " * bool(spot) + ("close to their home" if far < 0.5 else "about a mile from their home" if far < 1.5
                                     else f"about {round(far)} miles from their home")
    return spot, addr


def setup(keys):
    """Import the Twilio number and create the agent once; reuse their ids after that."""
    # A hosting service starts from a clean disk each deploy: SONAR_STATE carries the saved ids instead.
    state = json.loads(STATE.read_text() if STATE.exists() else os.environ.get("SONAR_STATE") or "{}")
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
    try:
        STATE.write_text(json.dumps(state, indent=1))
    except OSError as err:   # read-only disk on some hosts: the ids still work for this run
        print("could not save call/state.json:", err, flush=True)
    return state


def call_all(keys, state, friends, user_name, place, voice_id=None, lat=None, lng=None, home_address=""):
    """Text then ring every friend, all friends at the same time. Returns one result per friend."""
    said, addr = spoken_place(place.strip(), lat, lng, home_address)   # looked up once, shared by every friend's call
    print("location said on the call:", said or "(none)", "| address if asked:", addr or "(none)", flush=True)

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
                    "friend_name": f["name"], "user_name": user_name, "place": said, "address": addr,
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
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Passcode")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())

    def do_OPTIONS(self):
        self.reply(204, {})

    def do_GET(self):   # hosting services load this to see that the server is up
        self.reply(200, {"ok": True})

    def do_POST(self):
        if self.path != "/call":
            return self.reply(404, {"error": "POST /call"})
        # With a passcode set, only apps that know it can place calls (each call costs Twilio credit).
        code = self.keys.get("CALL_PASSCODE")
        if code and not hmac.compare_digest(self.headers.get("X-Passcode", "").encode(), code.encode()):
            return self.reply(401, {"error": "wrong or missing passcode"})
        try:
            data = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            # {friends: [{name, phone}], userName, place, lat?, lng?, homeAddress?}; phone in +1... form
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
        home = data.get("homeAddress")
        home = home[:200] if isinstance(home, str) else ""
        results = call_all(self.keys, self.state, friends, data.get("userName", "your friend"), data.get("place", ""),
                           voice, lat, lng, home)
        print("call:", [(r["name"], r["ok"], r["detail"], r["sms"]) for r in results], flush=True)
        self.reply(200 if any(r["ok"] for r in results) else 502, {"results": results})


def main():
    args = sys.argv[1:]
    if args and args[0] == "--where":   # no keys needed, nothing is called
        print(spoken_place("", float(args[1]), float(args[2]), args[3] if len(args) > 3 else "")[0] or "(nothing)")
        return
    keys = env()
    state = setup(keys)
    if args and args[0] == "--test":
        opt = dict(zip(args[2::2], args[3::2]))
        gps = [float(opt[k]) if k in opt else None for k in ("--lat", "--lng")] + [opt.get("--home", "")]
        res = call_all(keys, state, [{"name": opt.get("--name", "friend"), "phone": args[1]}],
                       opt.get("--user", "your friend"), opt.get("--place", ""), None, *gps)
        print(json.dumps(res, indent=1))
        return
    Handler.keys, Handler.state = keys, state
    # PORT set = running on a hosting service: listen to the internet, and only with a passcode.
    hosted = os.environ.get("PORT")
    if hosted and not keys.get("CALL_PASSCODE"):
        sys.exit("Set CALL_PASSCODE before hosting this: without it anyone could place calls on your Twilio account.")
    host, port = ("0.0.0.0", int(hosted)) if hosted else ("127.0.0.1", PORT)
    print(f"Ready: POST http://{host}:{port}/call", flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()

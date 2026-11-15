#!/usr/bin/env python3
"""Build the BreathBuddy demo video (narration-driven) from timeline.json.

Run:  python3 docs/submission/video/build.py
The narration is one webcam recording (sources.narr). timeline.json lists the narration pieces (source ranges,
stumbles removed, long pauses shortened automatically) and the picture segments; the narration lengths drive
every segment except the real-time alarm/call stretch, where phrases are anchored to the real events.
Output: out/breathbuddy-demo.mp4 (1920x1080, 30 fps, H.264 yuv420p + AAC); report in build/report.txt.
"""
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
FF, FP = '/opt/homebrew/bin/ffmpeg', '/opt/homebrew/bin/ffprobe'
NODE_PATH = '/private/tmp/claude-501/-Users-zeke-projects-sandhacks/fedccc0f-61fe-4d76-a51f-3974fb42604b/scratchpad/render/node_modules'
CREAM = '0xF4EFE6'
W, H, FPS = 1920, 1080, 30
B = 'build'
OUT = os.environ.get('OUT', 'out/breathbuddy-demo-v5.mp4')   # out/breathbuddy-demo.mp4 is the saved fallback
os.makedirs(B, exist_ok=True); os.makedirs('out', exist_ok=True)
T = json.load(open('timeline.json'))
SRC, CROPS, GAP = T['sources'], T['crops'], T['gap']
INSET_H = 864
log, report = [], []


def run(args):
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode:
        print('FAILED rc', r.returncode, ' '.join(map(str, args))[:1500]); print('STDERR:', r.stderr[-3000:]); sys.exit(1)
    return r


def dur(path):
    return float(run([FP, '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]).stdout.strip())


def enc(extra):
    return ['-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', str(FPS)] + extra


def blur_chain(label, boxes, t_shift, tag):
    if not boxes: return f'[{label}]null[{tag}]'
    parts, cur = [], label
    for i, (x, y, w, h, t0, t1) in enumerate(boxes):
        a, b = max(0, t0 - t_shift), t1 - t_shift
        parts.append(f'[{cur}]split[{tag}m{i}][{tag}s{i}];[{tag}s{i}]crop={w}:{h}:{x}:{y},boxblur=30:5[{tag}b{i}];'
                     f"[{tag}m{i}][{tag}b{i}]overlay={x}:{y}:enable='between(t,{a:.2f},{b:.2f})'[{tag}o{i}]")
        cur = f'{tag}o{i}'
    return ';'.join(parts) + f';[{cur}]null[{tag}]'


def crop_f(name):
    w, h, x, y = CROPS[name]; return f'crop={w}:{h}:{x}:{y}'


# ---------- 1. narration: clean each recording once with the same chain and loudness ----------
CHAIN = 'highpass=f=80,afftdn=nf=-25,acompressor=threshold=-24dB:ratio=2.5:attack=15:release=250:makeup=1'
NARR = SRC['narr']
VIDEO = {'narr': SRC['narr'], 'conc': SRC['conc'], 'intro': SRC['intro']}
CLEAN, SILS = {}, {}


def prep(tag):
    if tag in CLEAN: return
    src = SRC[tag]; lim = ['-t', '231'] if tag == 'narr' else []
    m = run([FF, '-nostats'] + lim + ['-i', src, '-vn', '-af', CHAIN + ',loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-']).stderr
    js = json.loads(m[m.rindex('{'):m.rindex('}') + 1])
    ln = (f"loudnorm=I=-16:TP=-1.5:LRA=11:linear=true:measured_I={js['input_i']}:measured_TP={js['input_tp']}:"
          f"measured_LRA={js['input_lra']}:measured_thresh={js['input_thresh']}:offset={js['target_offset']}")
    CLEAN[tag] = f'{B}/clean_{tag}.wav'
    run([FF, '-v', 'error', '-y'] + lim + ['-i', src, '-vn', '-af', CHAIN + ',' + ln + ',alimiter=limit=0.84:level=false,aresample=48000',
         '-ac', '2', '-ar', '48000', CLEAN[tag]])
    err = run([FF, '-nostats', '-i', src, '-vn', '-af', 'highpass=f=80,silencedetect=noise=-38dB:d=0.12', '-f', 'null', '-']).stderr
    sil = list(zip([float(x) for x in re.findall(r'silence_start: ([\d.]+)', err)], [float(x) for x in re.findall(r'silence_end: ([\d.]+)', err)]))
    merged = []
    for s0, s1 in sil:
        if merged and s0 - merged[-1][1] < 0.1: merged[-1][1] = s1
        else: merged.append([s0, s1])
    SILS[tag] = merged
    print(f'{tag}: loudness in {js["input_i"]} LUFS -> -16')


def quiet_point(tag, s, e):
    """time of the quietest 20 ms inside [s, e] of the raw recording (for cuts inside running speech)"""
    err = run([FF, '-nostats', '-ss', str(s), '-t', str(e - s), '-i', SRC[tag], '-vn', '-af',
               'asetnsamples=960,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level', '-f', 'null', '-']).stderr
    v = [float(x) if x not in ('-inf', 'inf') else -200.0 for x in re.findall(r'RMS_level=(-?[\w.]+)', err)]
    i = min(range(len(v)), key=lambda j: v[j]); return s + i * 0.02 + 0.01, v[i]


def keep_ranges(part):
    tag = part.get('file', 'narr'); prep(tag)
    a, b = part['range']
    if 'cut_search_end' in part:
        b, lvl = quiet_point(tag, *part['cut_search_end']); log_cuts.append(f'{tag} cut at {b:.3f} s (quietest 20 ms, {lvl:.0f} dB) in {part["cut_search_end"]}')
    ks = [[a, b]]
    rem = list(part.get('remove', []))
    if part.get('auto_pause', True):
        pmin, keep = part.get('pause_min', 0.9), part.get('pause_keep', 0.4)
        rem += [[s0 + keep / 2, s1 - keep / 2] for s0, s1 in SILS[tag] if s0 > a and s1 < b and s1 - s0 > pmin]
    for r0, r1 in sorted(rem):
        out = []
        for k0, k1 in ks:
            if r1 <= k0 or r0 >= k1: out.append([k0, k1]); continue
            if r0 > k0: out.append([k0, r0])
            if r1 < k1: out.append([r1, k1])
        ks = out
    return [(tag, k0, k1) for k0, k1 in ks]


log_cuts = []
PIECES = {}
for name, spec in T['narration_pieces'].items():
    parts = spec.get('parts', [dict(spec, file='narr')])
    items = []
    for p in parts:
        if p.get('gap_before'): items.append(('gap', 0.0, p['gap_before']))
        items += keep_ranges(p)
    tags = sorted({it[0] for it in items if it[0] != 'gap'}); idx = {t_: i for i, t_ in enumerate(tags)}
    fc, labs = [], []
    for i, (tag, k0, k1) in enumerate(items):
        L = k1 - k0
        if tag == 'gap': fc.append(f'anullsrc=r=48000:cl=stereo,atrim=0:{L:.3f}[k{i}]')
        else: fc.append(f'[{idx[tag]}:a]atrim={k0:.3f}:{k1:.3f},asetpts=PTS-STARTPTS,afade=t=in:d=0.015,afade=t=out:st={L - 0.015:.3f}:d=0.015[k{i}]')
        labs.append(f'[k{i}]')
    fc.append(''.join(labs) + f'concat=n={len(labs)}:v=0:a=1[a]')
    wav = f'{B}/narr_{name}.wav'
    run([FF, '-v', 'error', '-y'] + sum([['-i', CLEAN[t_]] for t_ in tags], []) + ['-filter_complex', ';'.join(fc), '-map', '[a]', '-ac', '2', '-ar', '48000', wav])
    PIECES[name] = {'wav': wav, 'keeps': items, 'len': sum(k1 - k0 for _, k0, k1 in items)}


def src_to_piece(name, ts, tag='narr'):
    acc = 0.0
    for (tg, k0, k1) in PIECES[name]['keeps']:
        if tg == tag and ts <= k1: return acc + max(0.0, ts - k0)
        acc += k1 - k0
    return acc


# ---------- 2. lay out segments ----------
segs = T['segments']
text_jobs, overlays, audio_items, seg_files = [], [], [], []
t = 0.0


def add_text(png, html, a, b):
    text_jobs.append({'out': png, 'html': html}); overlays.append((png, a, b))


def cap(png, text, a, b, style):
    add_text(png, f"<div class='cap' style='{style}'>{text}</div>", a, b)


def place(name, at):
    audio_items.append((PIECES[name]['wav'], at, 0)); return at + PIECES[name]['len']


def band_html(sl):
    band = "position:absolute;left:0;right:0;bottom:0;background:rgba(18,16,14,.72);color:#fff;padding:34px 154px 46px"
    if sl.get('title'):
        return (f"<div style='{band}'><div style='font-size:180px;font-weight:800;letter-spacing:-3px;line-height:1'>BreathBuddy</div>"
                f"<div style='font-size:48px;margin-top:22px'>breathbuddy.us &nbsp;&middot;&nbsp; Prototype. Not a medical device.</div></div>")
    if sl.get('big'):
        return (f"<div style='{band}'><div style='font-size:150px;font-weight:800;line-height:1'>{sl['head']}</div>"
                f"<div style='font-size:56px;margin-top:16px'>{sl['line']}</div></div>")
    return (f"<div style='{band}'><div style='font-size:76px;font-weight:700;line-height:1.1'>{sl['head']}</div>"
            + (f"<div style='font-size:56px;margin-top:14px'>{sl['line']}</div>" if sl.get('line') else '') + "</div>")


def render_slides(sid, slides, t0, D, piece_start):
    """slides fill [t0, t0+D]; each slide ends at its 'until' (narration source time) or at the end."""
    bounds, parts = [], []
    for sl in slides:
        u = sl['until']
        bounds.append(t0 + D if u == 'end' else piece_start[u[0]] + src_to_piece(u[0], u[1], u[2] if len(u) > 2 else 'narr'))
    a = t0
    for j, (sl, b) in enumerate(zip(slides, bounds)):
        d = b - a; po = f'{B}/slide_{sid}_{j}.mp4'; src = SRC[sl['src']]
        vf = (crop_f(sl['crop']) + ',' if sl.get('crop') else '') + f'scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1'
        if sl.get('still'):
            run([FF, '-v', 'error', '-y', '-ss', str(sl['in']), '-i', src, '-frames:v', '1', '-update', '1', '-vf', vf, f'{B}/still_{sid}.png'])
            run([FF, '-v', 'error', '-y', '-loop', '1', '-framerate', str(FPS), '-i', f'{B}/still_{sid}.png', '-vf', 'format=yuv420p'] + enc(['-t', f'{d:.3f}', po]))
        else:
            run([FF, '-v', 'error', '-y', '-ss', str(sl['in']), '-t', f'{d + 0.2:.3f}', '-i', src, '-vf', f'setpts=PTS-STARTPTS,{vf},fps={FPS}'] + enc(['-t', f'{d:.3f}', po]))
        if sl.get('crop'): log.append(f"mac rec {sl['in']:.1f}-{sl['in'] + d:.1f}s: crop {CROPS[sl['crop']]} (app + dashboard only; no address bar, tabs or notifications)")
        parts.append(po); add_text(f'{B}/slide_{sid}_{j}.png', band_html(sl), a, b)
        report.append((f'{sid} slide {j + 1}', sl['src'] + (' still' if sl.get('still') else ''), f"{sl['in']}-{sl['in'] + d:.1f}", '1x', d))
        a = b
    return parts


def concat_copy(sid, parts, out):
    with open(f'{B}/cat_{sid}.txt', 'w') as f:
        for p_ in parts: f.write(f"file '{os.path.abspath(p_)}'\n")
    run([FF, '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', f'{B}/cat_{sid}.txt'] + enc([out]))   # re-encode: stream-copied joins decoded wrongly


piece_start = {}
for i, s in enumerate(segs):
    k, sid = s['kind'], s['id']
    out = f'{B}/seg_{i:02d}_{sid}.mp4'

    if k == 'webcam':
        nm = s['narr']; xf = s.get('xfade_next', 0.0)
        D = PIECES[nm]['len'] + s.get('gap_after', GAP)
        piece_start[nm] = t; place(nm, t)
        clips = [it for it in PIECES[nm]['keeps'] if it[0] != 'gap']
        ins, fc = [], []
        for j, (tag, k0, k1) in enumerate(clips):
            L = k1 - k0 + ((D - PIECES[nm]['len'] + xf) if j == len(clips) - 1 else 0.0)
            ins += ['-ss', f'{k0:.3f}', '-t', f'{L + 0.1:.3f}', '-i', VIDEO[tag]]
            zoom = 1.08 if j % 2 else 1.0          # punch-in hides the jump at internal cuts
            fc.append(f'[{j}:v]setpts=PTS-STARTPTS,fps={FPS},crop=iw/{zoom}:ih/{zoom},scale={W}:{H}:flags=lanczos,setsar=1,tpad=stop_mode=clone:stop_duration=2,trim=duration={L:.3f}[w{j}]')
        fc.append(''.join(f'[w{j}]' for j in range(len(clips))) + f'concat=n={len(clips)}:v=1:a=0[v]')
        run([FF, '-v', 'error', '-y'] + ins + ['-filter_complex', ';'.join(fc), '-map', '[v]'] + enc(['-t', f'{D + xf:.3f}', out]))
        for j, bd in enumerate(s.get('bands', [])):
            fa = piece_start[nm] + src_to_piece(bd['from'][0], bd['from'][1], bd['from'][2])
            fb = t + D if bd['to'] == 'end' else piece_start[nm] + src_to_piece(bd['to'][0], bd['to'][1], bd['to'][2])
            add_text(f'{B}/band_{sid}_{j}.png', band_html({'head': bd['text']}), fa, fb)
        report.append((sid, 'webcam ' + '+'.join(sorted({VIDEO[c[0]].split('/')[-1] for c in clips})), ' + '.join(f'{k0:.2f}-{k1:.2f}' for _, k0, k1 in clips), '1x', D))

    elif k == 'phone':
        nm = s['narr']; D = PIECES[nm]['len'] + GAP; piece_start[nm] = t; place(nm, t)
        ins, fc, labels = [], [], []
        raw = sum(p['out'] - p['in'] for p in s['pieces']); speed = raw / D
        for j, p in enumerate(s['pieces']):
            ins += ['-ss', str(p['in']), '-t', f"{p['out'] - p['in']:.3f}", '-i', SRC['phone']]
            # solid blocks (not blur) over anything private on the friend's phone
            boxes = ','.join(f"drawbox=x={x}:y={y}:w={w}:h={h}:color=0xC9C9CE@1:t=fill:enable='between(t,{max(0, t0):.2f},{t1:.2f})'" for (x, y, w, h, t0, t1) in p['blur'])
            fc.append(f'[{j}:v]' + (boxes or 'null') + f'[p{j}]')
            for (x, y, w, h, t0, t1) in p['blur']:
                log.append(f"phone rec {p['in'] + t0:.1f}-{min(p['out'], p['in'] + t1):.1f}s: solid block x{x} y{y} {w}x{h} (phone px) - " + ('share-sheet contact names' if y > 1100 else 'invite link URL' if y > 600 else "Messages 'To:' name"))
            fc.append(f'[p{j}]setpts=PTS-STARTPTS,fps=60[q{j}]'); labels.append(f'[q{j}]')
        fc.append(''.join(labels) + f'concat=n={len(labels)}:v=1:a=0[cat];[cat]setpts=PTS/{speed:.4f},fps={FPS},split[c1][c2];'
                  f'[c1]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},boxblur=40:2,eq=brightness=-0.25,setsar=1[bg];'
                  f'[c2]scale=-2:1000,pad=iw+8:ih+8:4:4:color=0xF4EFE6[ph];[bg][ph]overlay=x={int(W * 0.22)}-w/2:y=(H-h)/2[v]')
        run([FF, '-v', 'error', '-y'] + ins + ['-filter_complex', ';'.join(fc), '-map', '[v]'] + enc(['-t', f'{D:.3f}', out]))
        l1, l2 = s['big_caption']
        add_text(f'{B}/big_{sid}.png', f"<div style='position:absolute;left:{int(W * 0.22) + 260}px;right:60px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;color:#fff'>"
                 f"<div style='font-size:44px;font-weight:600;opacity:.85;margin-bottom:30px'>{s['label']}</div>"
                 f"<div style='font-size:96px;font-weight:800;line-height:1.12'>{l1}<br>{l2}</div></div>", t, t + D)
        report.append((sid, 'iPhone rec 09-05-23', '; '.join(f"{p['in']}-{p['out']}" for p in s['pieces']), f'{speed:.2f}x', D))

    elif k in ('pip', 'realtime'):
        cam = SRC[s['cam']]; cin = s['cam_in']
        if k == 'realtime':
            ends = []
            for an in s['anchored']: ends.append(an['at_cam'] + PIECES[an['narr']]['len'])
            cout = min(s['max_cam_out'], max(ends) + s['after_last_narr'])
            for an in s['anchored']: piece_start[an['narr']] = t + an['at_cam'] - cin; place(an['narr'], t + an['at_cam'] - cin)
            raw = cout - cin; D = raw; speed = 1.0; lead_len = 0.0; parts = []
        else:
            nm = s['narr']; cout = s['cam_out']; raw = cout - cin
            D = PIECES[nm]['len'] + s.get('tail', GAP)
            if 'max_speed' in s: D = max(D, raw / s['max_speed'])
            piece_start[nm] = t; place(nm, t)
            parts, lead_len = [], 0.0
            if s.get('lead'):
                ld = s['lead']; lead_len = ld['out'] - ld['in']; lo = f'{B}/lead_{sid}.mp4'
                run([FF, '-v', 'error', '-y', '-ss', str(ld['in']), '-t', f'{lead_len + 0.2:.3f}', '-i', SRC['mac'], '-filter_complex',
                     f'[0:v]{crop_f(ld["crop"])}[c0];' + blur_chain('c0', ld['blur'], 0, 'lb') + f';[lb]setpts=PTS-STARTPTS,fps={FPS},scale={W}:{H},setsar=1[v]',
                     '-map', '[v]'] + enc(['-t', f'{lead_len:.3f}', lo]))
                parts.append(lo)
                log.append(f"mac rec {ld['in']:.1f}-{ld['out']:.1f}s: crop to the Messages conversation only {CROPS[ld['crop']]} (hides chat app, contact list, menu bar, notifications); blur top 255 px (sender name + location, older message with an IP link)")
                cap(f'{B}/leadcap_{sid}.png', ld['caption'], t, t + lead_len, 'left:60px;bottom:200px')
                report.append((sid + ' (lead)', 'Mac rec (Messages)', f"mac {ld['in']}-{ld['out']}", '1x', lead_len))
            speed = raw / (D - lead_len)
        Dm = D - lead_len
        m_in = cin + T['mac_offset']
        log.append(f"mac rec {m_in:.1f}-{m_in + raw:.1f}s: crop to app screen only {CROPS['app']} (hides address bar, tabs, bookmarks, notifications, dashboard)")
        ab = s.get('app_blur', [])
        for (x, y, w, h, t0, t1) in ab:
            if t1 > m_in: log.append(f"mac rec {max(t0, m_in):.1f}-{t1:.1f}s: blur friend's phone number on 'Hi Zeke' screen, x{x} y{y} {w}x{h} (app-crop px)")
        cb = s.get('cam_blur', [])
        for (x, y, w, h, t0, t1) in cb:
            if t0 < cout: log.append(f"{s['cam']} {t0:.1f}-{t1:.1f}s: blur x{x} y{y} {w}x{h} (camera px) - audio-output menu on friend's phone showing a device name")
        fc = (f'[1:v]{crop_f("app")}[mc];' + blur_chain('mc', ab, m_in, 'mb') + ';'
              f'[mb]setpts=(PTS-STARTPTS)/{speed:.5f},fps={FPS},scale=-2:{INSET_H},pad=iw+8:ih+8:4:4:color={CREAM}[m];'
              + blur_chain('0:v', cb, cin, 'cbl') + ';'
              f'[cbl]setpts=(PTS-STARTPTS)/{speed:.5f},fps={FPS},scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1[c];'
              f'[c][m]overlay=W-w-40:40[v]')
        mo = f'{B}/main_{sid}.mp4' if parts else out
        run([FF, '-v', 'error', '-y', '-ss', str(cin), '-t', f'{raw + 0.2:.3f}', '-i', cam,
             '-ss', f'{m_in:.3f}', '-t', f'{raw + 0.2:.3f}', '-i', SRC['mac'], '-filter_complex', fc, '-map', '[v]'] + enc(['-t', f'{Dm:.3f}', mo]))
        if parts: concat_copy(sid, parts + [mo], out)
        tm = t + lead_len
        def at_cam(c, tm=tm, cin=cin, speed=speed): return tm + (c - cin) / speed
        add_text(f'{B}/lab_{sid}.png', f"<div class='cap' style='left:{W - 40 - 432 + 16}px;top:56px;font-size:26px;padding:5px 12px'>{s['label']}</div>", tm, tm + Dm)
        for j, cw in enumerate(s.get('caption_windows', [])):
            cap(f'{B}/cw_{sid}_{j}.png', cw['text'], at_cam(cw['from_cam']), at_cam(min(cw['to_cam'], cout)), 'left:60px;bottom:120px')
        if s.get('caption'): cap(f'{B}/cap_{sid}.png', s['caption'], tm, tm + Dm, 'left:60px;bottom:120px')
        if s.get('hold_count'):
            h0, h1 = s['hold_count']; k = 1
            while h0 + k - 1 < h1:
                cap(f'{B}/hold_{k}.png', f'holding breath &nbsp;{k} s', at_cam(h0 + k - 1), at_cam(min(h0 + k, h1)), 'left:60px;bottom:190px'); k += 1
        for j, tc in enumerate(s.get('timed_captions', [])):
            if tc['from_cam'] < cout:
                cap(f'{B}/tc_{sid}_{j}.png', tc['text'], at_cam(tc['from_cam']), at_cam(min(tc['to_cam'], cout)), 'left:60px;bottom:190px')
        if k == 'realtime':
            v0, v1 = s['call_voice']
            meas = run([FF, '-nostats', '-ss', str(v0), '-t', str(v1 - v0), '-i', cam, '-vn', '-af', 'ebur128', '-f', 'null', '-']).stderr
            I = float(re.findall(r'I:\s+(-?[\d.]+) LUFS', meas)[-1]); gain = s['call_target_lufs'] - I
            rb = s['ring_boost']
            ring = f"volume='if(between(t,{rb[0] - cin:.2f},{rb[1] - cin:.2f}),{10 ** (rb[2] / 20):.3f},1)':eval=frame,"
            hb = s.get('hold_boost')
            if hb: ring += f"volume='if(between(t,{hb[0] - cin:.2f},{hb[1] - cin:.2f}),{10 ** (hb[2] / 20):.3f},1)':eval=frame,"
            ring = 'afftdn=nf=-30,' + ring
            # duck under the narration: -12 dB while he speaks, 0.15 s ramps
            iv = [(an['at_cam'] - cin, an['at_cam'] - cin + PIECES[an['narr']]['len']) for an in s['anchored']]
            depth = 1 - 10 ** (s['duck_db'] / 20)
            r = '0'
            for (a, b) in iv: r = f'max({r},clip(min((t-{a - 0.15:.2f})/0.15,({b + 0.15:.2f}-t)/0.15),0,1))'
            duck = f"volume='1-{depth:.3f}*{r}':eval=frame,"
            wav = f'{B}/a_{sid}.wav'
            run([FF, '-v', 'error', '-y', '-ss', str(cin), '-t', f'{raw:.3f}', '-i', cam, '-vn', '-af',
                 ring + f'volume={gain:.1f}dB,' + duck + f'alimiter=limit=0.89:level=false,afade=t=in:d=0.2,afade=t=out:st={raw - 0.4:.2f}:d=0.4,aresample=48000',
                 '-ac', '2', '-ar', '48000', wav])
            audio_items.append((wav, t, 0))
            print(f'camera audio: call voice {I:.1f} LUFS -> gain {gain:+.1f} dB whole stretch; ring cam {rb[0]}-{rb[1]} +{rb[2]} dB; ducked {s["duck_db"]} dB under narration')
            report.append((sid, f"{s['cam']} + Mac rec", f'cam {cin}-{cout:.1f} / mac {m_in:.1f}-{m_in + raw:.1f}', '1x real time, no cuts', D))
        else:
            report.append((sid, f"{s['cam']} + Mac rec", f'cam {cin}-{cout} / mac {m_in:.1f}-{m_in + raw:.1f}', f'{speed:.2f}x', D))

    elif k == 'macclip':
        nm = s['narr']; piece_start[nm] = t; place(nm, t)
        D = src_to_piece(nm, s['until_src']) if 'until_src' in s else PIECES[nm]['len'] + GAP
        m0 = s['end'] - D
        run([FF, '-v', 'error', '-y', '-ss', f'{m0:.3f}', '-t', f'{D + 0.2:.3f}', '-i', SRC['mac'], '-vf',
             f'{crop_f(s["crop"])},setpts=PTS-STARTPTS,fps={FPS},scale={W}:{H}:flags=lanczos,setsar=1'] + enc(['-t', f'{D:.3f}', out]))
        log.append(f"mac rec {m0:.1f}-{s['end']:.1f}s: crop to the dashboard 'What the sonar sees' panel only {CROPS[s['crop']]} (no address bar, contact, or event log)")
        cap(f'{B}/lab_{sid}.png', s['label'], t, t + D, 'left:60px;top:48px')
        report.append((sid, 'Mac rec dashboard (take 1404)', f'mac {m0:.1f}-{s["end"]}', '1x', D))

    elif k == 'slides':
        if 'narr_cont' in s:                    # continues a piece already playing, then the next piece
            nm = s['narr_cont']; end_cont = piece_start[nm] + PIECES[nm]['len']
            nxt = s['then']; piece_start[nxt] = end_cont + GAP; place(nxt, end_cont + GAP)
            D = end_cont + GAP + PIECES[nxt]['len'] + GAP - t
        elif 'narr' in s:
            nm = s['narr']; piece_start[nm] = t; place(nm, t); D = PIECES[nm]['len'] + GAP
        else:
            D = s['dur']
        concat_copy(sid, render_slides(sid, s['slides'], t, D, piece_start), out)

    seg_files.append(out)
    s['_start'], s['_dur'] = t, D
    t += D

total = t
# cross-fade joins (video only; the first segment was rendered xf longer so timing is unchanged)
joined, i = [], 0
while i < len(seg_files):
    s = segs[i]; xf = s.get('xfade_next', 0.0) if s['kind'] == 'webcam' else 0.0
    if xf and i + 1 < len(seg_files):
        o = f'{B}/xf_{s["id"]}.mp4'
        run([FF, '-v', 'error', '-y', '-i', seg_files[i], '-i', seg_files[i + 1], '-filter_complex',
             f'[0:v][1:v]xfade=transition=fade:duration={xf}:offset={s["_dur"]:.3f}[v]', '-map', '[v]'] + enc([o]))
        want = s['_dur'] + segs[i + 1]['_dur']; got = dur(o)
        if abs(got - want) > 0.1: print(f'FAILED cross-fade join is {got:.2f} s, expected {want:.2f} s'); sys.exit(1)
        joined.append(o); i += 2
    else:
        joined.append(seg_files[i]); i += 1
seg_files = joined
print(f'total {total:.1f} s')
if total > 180: print('WARNING: over 180 s')

# ---------- 3. text PNGs ----------
json.dump(text_jobs, open(f'{B}/text_jobs.json', 'w'))
run(['env', f'NODE_PATH={NODE_PATH}', 'node', 'text/render_text.js', f'{B}/text_jobs.json'])

# ---------- 4. final pass ----------
args = [FF, '-v', 'error', '-y']; fc = []
for i, o in enumerate(seg_files):
    args += ['-i', o]
    fc.append(f'[{i}:v]scale=out_range=tv:out_color_matrix=bt709,format=yuv420p,setsar=1,fps={FPS}[s{i}]')
fc.append(''.join(f'[s{i}]' for i in range(len(seg_files))) + f'concat=n={len(seg_files)}:v=1:a=0[base]')
cur, n = 'base', len(seg_files)
for (png, a, b) in overlays:
    args += ['-loop', '1', '-framerate', '2', '-t', f'{total:.3f}', '-i', png]
    fc.append(f"[{cur}][{n}:v]overlay=0:0:enable='gte(t,{a:.3f})*lt(t,{b:.3f})'[v{n}]"); cur = f'v{n}'; n += 1
# audio mix rendered on its own to a WAV with continuous timestamps, then muxed
aargs = [FF, '-v', 'error', '-y']; afc = []; al = []
for j, (wav, at, g) in enumerate(audio_items):
    aargs += ['-i', wav]; ms = int(round(at * 1000))
    afc.append(f'[{j}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay={ms}|{ms},volume={g}dB,apad[a{j}]'); al.append(f'[a{j}]')
afc.append(''.join(al) + f'amix=inputs={len(al)}:normalize=0:duration=longest,atrim=0:{total:.3f},asetpts=N/SR/TB,'
           f'alimiter=limit=0.89:level=false,afade=t=out:st={total - 0.5:.3f}:d=0.5[aout]')
run(aargs + ['-filter_complex', ';'.join(afc), '-map', '[aout]', '-c:a', 'pcm_s16le', '-ar', '48000', f'{B}/mix.wav'])
def loud(path):
    m = run([FF, '-nostats', '-i', path, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-']).stderr
    return json.loads(m[m.rindex('{'):m.rindex('}') + 1])
L0 = loud(f'{B}/mix.wav'); LOUD = f"mix: {L0['input_i']} LUFS integrated, {L0['input_tp']} dBTP true peak"
if not (-18 <= float(L0['input_i']) <= -14) or float(L0['input_tp']) > -1:
    run([FF, '-v', 'error', '-y', '-i', f'{B}/mix.wav', '-af',
         f"loudnorm=I=-16:TP=-1.5:LRA=11:linear=true:measured_I={L0['input_i']}:measured_TP={L0['input_tp']}:measured_LRA={L0['input_lra']}:measured_thresh={L0['input_thresh']}:offset={L0['target_offset']},aresample=48000",
         '-c:a', 'pcm_s16le', f'{B}/mix_ln.wav'])
    os.replace(f'{B}/mix_ln.wav', f'{B}/mix.wav'); L1 = loud(f'{B}/mix.wav')
    LOUD += f" -> loudnorm pass -> {L1['input_i']} LUFS, {L1['input_tp']} dBTP"
print(LOUD)
print(f"mix.wav {dur(f'{B}/mix.wav'):.3f} s (video {total:.3f} s)")
args += ['-i', f'{B}/mix.wav']
fc.append(f'[{cur}]null[vout]')
run(args + ['-filter_complex', ';'.join(fc), '-map', '[vout]', '-map', f'{n}:a', '-t', f'{total:.3f}',
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', str(FPS),
            '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
            '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', OUT])

# ---------- 5. report ----------
with open(f'{B}/report.txt', 'w') as f:
    f.write(f'{OUT}  {dur(OUT):.2f} s\n\nsegment | source | in-out (s) | speed | length (s)\n')
    for r in report: f.write(' | '.join(f'{x:.1f}' if isinstance(x, float) else str(x) for x in r) + '\n')
    f.write('\nsegment starts: ' + ', '.join(f"{s['id']}@{s['_start']:.1f}" for s in segs) + '\n')
    f.write('\nnarration pieces (kept source ranges in hackathon.mov -> placed at output time):\n')
    for nm, p in PIECES.items():
        f.write(f"{nm}: " + ' + '.join(('[gap %.2f]' % b) if tg == 'gap' else f'{tg} {a:.2f}-{b:.2f}' for tg, a, b in p['keeps']) + f"  ({p['len']:.1f} s) at {piece_start.get(nm, -1):.1f}\n")
    f.write('\n' + '\n'.join(log_cuts) + '\n')
    f.write('\nprivacy crops/blurs:\n' + '\n'.join(dict.fromkeys(log)) + '\n')
print(open(f'{B}/report.txt').read())

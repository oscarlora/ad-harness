#!/usr/bin/env python3
# song-edit.py — the timing math behind an AI song ad (see skills/make-ai-song); shots and sfx also
# place a narrated AI animation on its voiceover (skills/make-ai-animation). Four commands:
#
#   timing    Trim a Suno take to its sung part (+ outro and fade) and write the line/word timings.
#   shots     Find the real cuts inside each generated clip and place every shot on its line.
#   sfx       Render the placed shots' own audio (the clips' sound effects) as one track on the timeline.
#   captions  Build the word-by-word captions as Palmier text clips, one list per word slot.
#
# Usage:
#   python3 tools/song-edit.py timing --take music/song-suno.mp3 --lyrics music/lyrics.txt \
#       --out music/song-final.mp3 [--outro 5] [--fade 3]
#     Reads <take>.suno-words.json (written by generate-music.mjs --lyrics). Writes the trimmed
#     song and <out>.timing.json: {offset, duration, lines:[{section,text,start,end,words}]},
#     all in seconds on the trimmed song.
#
#   python3 tools/song-edit.py shots --plan shots.json --out shots-placed.json [--fps 30] [--scene 0.25] [--max-rate 1]
#     plan: {"clips":[{"file":"clips/clip-01.mp4","starts":[0,5.1,9.89],"end":14.67}, ...]}
#     (starts/end = song or voiceover seconds where each shot of that clip should play). Writes one
#     entry per shot: {file, startFrame, endFrame, source:[a,b], rate}. rate < 1 means slow the shot to
#     fill its line (Palmier edit_speed uniform); under 0.8 it shows, so it prints a warning. A shot
#     longer than its line is trimmed, or with --max-rate above 1 sped up to that rate first, so an
#     action at its end still plays (1.35 for animation).
#
#   python3 tools/song-edit.py sfx --placed shots-placed.json --out audio/sfx.wav [--fps 30]
#     Each placed shot's own audio, cut and tempo-matched like its picture, at its start; one mixed WAV
#     the length of the timeline, for its own track (the clips go in with includeAudio false).
#
#   python3 tools/song-edit.py captions --timing music/song-final.mp3.timing.json --out caps.json \
#       [--skip-until 5.03] [--size 78] [--y 0.5]
#     Writes {"slots":[[...],[...],...]}: each slot is one add_texts call on its own track (words on
#     one track would overwrite each other). Up to 4 words per caption, never across two sung lines,
#     one line always (long groups shrink), active word yellow and 25% bigger, the rest reflow.
#     --skip-until drops captions that start before that time (room for a hook).
#
# Requires ffmpeg/ffprobe and Pillow. The font is measured locally; --scale is how much bigger
# Palmier draws it (1.77 for Permanent Marker, measured) — re-measure if you change fonts.

import argparse, json, os, re, subprocess, sys

clean = lambda w: re.sub(r'[",.!?;:\[\]]', '', w).strip()
tokens = lambda s: [t for t in (clean(x) for x in s.split()) if t]


def timing(a):
    words = json.load(open(re.sub(r'\.[^.]+$', '.suno-words.json', a.take)))['aligned_words']
    ws = [dict(word=re.sub(r'\[.*?\]\s*', '', w['word']).strip(), start=w['startS'], end=w['endS']) for w in words]
    ws = [w for w in ws if clean(w['word'])]
    start = max(0, ws[0]['start'] - 0.15)
    dur = ws[-1]['end'] + a.outro - start
    # -ss before -i: the fade's clock starts at the cut (after -i it counts from the original start
    # and silences the last lines).
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{start:.3f}', '-i', a.take, '-t', f'{dur:.3f}',
                    '-af', f'afade=t=out:st={dur - a.fade:.3f}:d={a.fade}', '-c:a', 'libmp3lame', '-q:a', '2', a.out], check=True)
    lines, i, sec = [], 0, None
    for raw in open(a.lyrics):
        raw = raw.strip()
        if not raw: continue
        if raw.startswith('['): sec = raw.strip('[]'); continue
        n = len(tokens(raw)); lw = ws[i:i + n]; i += n
        if not lw: break
        lines.append(dict(section=sec, text=raw, start=round(lw[0]['start'] - start, 3), end=round(lw[-1]['end'] - start, 3),
                          words=[dict(word=w['word'], start=round(w['start'] - start, 3), end=round(w['end'] - start, 3)) for w in lw]))
    if i != len(ws): print(f'WARN: lyrics have {i} words, Suno timed {len(ws)} — check for repeats or ad-libs', file=sys.stderr)
    json.dump(dict(audio=os.path.basename(a.out), take=a.take, offset=round(start, 3), duration=round(dur, 3), lines=lines),
              open(a.out + '.timing.json', 'w'), indent=1)
    print(f'{a.out}: {dur:.1f}s from {start:.2f}s, {len(lines)} lines -> {a.out}.timing.json')


def probe(f):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]))


def cuts(f, thr):
    out = subprocess.run(['ffmpeg', '-hide_banner', '-i', f, '-vf', f"select='gt(scene,{thr})',showinfo", '-an', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    return [float(t) for t in re.findall(r'pts_time:([0-9.]+)', out)]


def shots(a):
    base = os.path.dirname(os.path.abspath(a.plan)); out = []
    for c in json.load(open(a.plan))['clips']:
        f = os.path.join(base, c['file']); dur = probe(f)
        b = [0] + cuts(f, a.scene) + [dur]; st = c['starts'] + [c['end']]
        if len(b) != len(st): print(f"WARN: {c['file']}: found {len(b) - 1} shots, planned {len(c['starts'])} — check it by eye", file=sys.stderr)
        # A shot after a cut starts one frame late: Palmier floors source times to frames, and a
        # floored in-point shows the previous shot's last frame. Ends stay on the cut.
        for k in range(min(len(b), len(st)) - 1):
            s0 = b[k] + (1 / a.fps if k else 0)
            seg, win = b[k + 1] - s0, st[k + 1] - st[k]
            e = dict(file=c['file'], startFrame=round(st[k] * a.fps), endFrame=round(st[k + 1] * a.fps))
            if seg >= win:
                r = min(seg / win, a.max_rate)
                e.update(source=[round(s0, 3), round(s0 + win * r, 3)], rate=round(r, 4))
            else:
                e.update(source=[round(s0, 3), round(b[k + 1] - 0.02, 3)], rate=round((seg - 0.02) / win, 4))
                if e['rate'] < 0.8: print(f"WARN: {c['file']} shot {k + 1} slowed to {e['rate']:.2f}x", file=sys.stderr)
            out.append(e)
    json.dump(out, open(a.out, 'w'), indent=1); print(f'{len(out)} shots -> {a.out}')


def sfx(a):
    base = os.path.dirname(os.path.abspath(a.placed)); shots = json.load(open(a.placed))
    files = sorted({e['file'] for e in shots}); args, f = [], []
    for x in files: args += ['-i', os.path.join(base, x)]
    def tempo(r):
        out = []
        while r > 2: out.append('atempo=2'); r /= 2
        while r < 0.5: out.append('atempo=0.5'); r /= 0.5
        return ','.join(out + [f'atempo={r}'])
    for k, e in enumerate(shots):
        (s0, s1), win = e['source'], (e['endFrame'] - e['startFrame']) / a.fps
        f.append(f"[{files.index(e['file'])}:a]atrim={s0}:{s1},asetpts=PTS-STARTPTS,{tempo(e['rate'])},"
                 f"atrim=0:{win:.3f},adelay={round(e['startFrame'] / a.fps * 1000)}:all=1[s{k}]")
    end = max(e['endFrame'] for e in shots) / a.fps
    # A silent bed the timeline's length leads the mix, so a timeline that starts without a shot keeps its lead-in.
    f.append(f'aevalsrc=0:d={end:.3f}:s=48000[bed]')
    f.append('[bed]' + ''.join(f'[s{k}]' for k in range(len(shots))) + f'amix=inputs={len(shots) + 1}:normalize=0:duration=first[out]')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *args, '-filter_complex', ';'.join(f), '-map', '[out]',
                    '-ar', '48000', '-c:a', 'pcm_s16le', a.out], check=True)
    print(f'{len(shots)} shots, {end:.1f}s -> {a.out}')


def captions(a):
    from PIL import ImageFont
    font = os.path.expanduser(a.font)
    if not os.path.exists(font):
        sys.exit(f"ERROR: caption font not found: {font}\n"
                 "The default is Permanent Marker, free from Google Fonts (https://fonts.google.com/specimen/Permanent+Marker): "
                 "install it to that path, or pass --font <path to a .ttf> --font-name <its PostScript name>.")
    F = ImageFont.truetype(font, round(a.size * a.scale))
    groups = []
    for l in json.load(open(a.timing))['lines']:
        ws = [dict(w, word=clean(w['word'])) for w in l['words'] if clean(w['word'])]
        k = -(-len(ws) // a.max_words); n, r = divmod(len(ws), k); i = 0
        for j in range(k):
            s = n + (1 if j < r else 0); groups.append(ws[i:i + s]); i += s
    gap = F.getlength(' ') * 0.9
    ink = lambda w: (lambda b: b[2] - b[0])(F.getbbox(w))
    fr = lambda t: round(t * a.fps)
    style = lambda fs, col, ow: {"fontName": a.font_name, "fontSize": fs, "color": col, "alignment": "center",
                                 "outline": {"enabled": True, "color": "#000000", "width": ow},
                                 "shadow": {"enabled": True, "color": "#000000", "opacity": 0.45, "blur": 6, "offset": {"x": 0, "y": 5}}}
    slots = [[] for _ in range(a.max_words)]
    for gi, g in enumerate(groups):
        if g[0]['start'] < a.skip_until: continue
        wd = [ink(x['word']) for x in g]
        tot = lambda act: sum(w * (a.pop if j == act else 1) for j, w in enumerate(wd)) + gap * (len(g) - 1)
        f = min(1, a.max_width / max(tot(act) for act in range(len(g))))
        nxt = groups[gi + 1][0]['start'] if gi + 1 < len(groups) else None
        gend = g[-1]['end'] + 0.6
        if nxt is not None: gend = nxt if nxt - g[-1]['end'] < 1.2 else min(gend, nxt)
        g0, g1 = fr(g[0]['start'] - 0.08), fr(gend)
        for act, w in enumerate(g):
            s0 = g0 if act == 0 else fr(w['start']); s1 = fr(g[act + 1]['start']) if act + 1 < len(g) else g1
            if s1 <= s0: continue
            x = a.width / 2 - tot(act) * f / 2
            for j, xw in enumerate(g):
                ww = wd[j] * (a.pop if j == act else 1) * f
                slots[j].append({"content": xw['word'], "startFrame": s0, "endFrame": s1,
                                 "style": style(round(a.size * f * a.pop, 1), "#FFE100", 10) if j == act else style(round(a.size * f, 1), "#FFFFFF", 8),
                                 "transform": {"x": round((x + ww / 2) / a.width, 4), "y": a.y}})
                x += ww + gap * f
    json.dump({"slots": [s for s in slots if s]}, open(a.out, 'w'))
    print(f'{len(groups)} captions, {sum(map(len, slots))} text clips in {sum(1 for s in slots if s)} slots -> {a.out}')


p = argparse.ArgumentParser(description='AI song ad timing: timing | shots | sfx | captions')
sub = p.add_subparsers(dest='cmd', required=True)
t = sub.add_parser('timing'); t.add_argument('--take', required=True); t.add_argument('--lyrics', required=True)
t.add_argument('--out', required=True); t.add_argument('--outro', type=float, default=5); t.add_argument('--fade', type=float, default=3)
s = sub.add_parser('shots'); s.add_argument('--plan', required=True); s.add_argument('--out', required=True)
s.add_argument('--fps', type=int, default=30); s.add_argument('--scene', type=float, default=0.25); s.add_argument('--max-rate', type=float, default=1)
x = sub.add_parser('sfx'); x.add_argument('--placed', required=True); x.add_argument('--out', required=True); x.add_argument('--fps', type=int, default=30)
c = sub.add_parser('captions'); c.add_argument('--timing', required=True); c.add_argument('--out', required=True)
c.add_argument('--font', default='~/Library/Fonts/PermanentMarker-Regular.ttf'); c.add_argument('--font-name', default='PermanentMarker-Regular')
c.add_argument('--size', type=float, default=78); c.add_argument('--scale', type=float, default=1.77); c.add_argument('--pop', type=float, default=1.25)
c.add_argument('--max-words', type=int, default=4); c.add_argument('--max-width', type=float, default=990); c.add_argument('--width', type=int, default=1080)
c.add_argument('--y', type=float, default=0.5); c.add_argument('--fps', type=int, default=30); c.add_argument('--skip-until', type=float, default=0)
a = p.parse_args(); {'timing': timing, 'shots': shots, 'sfx': sfx, 'captions': captions}[a.cmd](a)

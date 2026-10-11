#!/usr/bin/env python3
# edit-song.py — the sung part of an AI song ad's Suno take and its word timings (skills/make-ai-song).
# Needs ffmpeg.
#
#   python3 tools/edit-song.py timing --take music/song-suno.mp3 --lyrics music/lyrics.txt \
#       --out music/song-final.mp3 [--outro 5] [--fade 3]
#     Trims a Suno take to its sung part (reads <take>.suno-words.json from generate-music.mjs --lyrics).
#     Writes the song and <out>.timing.json: {offset, duration, lines:[{section,text,start,end,words}]}.

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


p = argparse.ArgumentParser(description='AI song ad timing')
sub = p.add_subparsers(dest='cmd', required=True)
t = sub.add_parser('timing'); t.add_argument('--take', required=True); t.add_argument('--lyrics', required=True)
t.add_argument('--out', required=True); t.add_argument('--outro', type=float, default=5); t.add_argument('--fade', type=float, default=3)
a = p.parse_args(); {'timing': timing}[a.cmd](a)

#!/usr/bin/env python3
"""Authorized, bounded catalogue build. Key is read from a protected file; never logged.

One JSON intent is fsynced before every paid request. Existing/unknown intents
are never resubmitted. Run again to poll/download; no automatic top-ups.
"""
import argparse, concurrent.futures, datetime, hashlib, json, os, pathlib, subprocess, time

parser = argparse.ArgumentParser()
parser.add_argument('--key-file', required=True)
parser.add_argument('--directory', required=True)
parser.add_argument('--briefs', required=True)
parser.add_argument('--origin', required=True)
parser.add_argument('--max-requests', type=int, default=120)
parser.add_argument('--credit-budget', type=float, default=1440)
parser.add_argument('--credits-per-request', type=float, default=12)
parser.add_argument('--submit', action='store_true')
parser.add_argument('--rounds', type=int, default=1)
parser.add_argument('--concurrency', type=int, default=8)
args = parser.parse_args()
root = pathlib.Path(args.directory).resolve(); root.mkdir(parents=True, exist_ok=True)
key = pathlib.Path(args.key_file).read_text().strip()
briefs = json.loads(pathlib.Path(args.briefs).read_text())
if args.max_requests > 120 or args.max_requests < 1 or args.credit_budget <= 0 or args.credits_per_request <= 0 or not 1 <= args.concurrency <= 12:
    raise SystemExit('Invalid bounded generation limits')

def write(path, value):
    temp = path.with_suffix('.next')
    with open(temp, 'w') as f:
        json.dump(value, f, indent=2); f.flush(); os.fsync(f.fileno())
    os.replace(temp, path)

def request(path, body=None):
    config = 'url = "https://apibox.erweima.ai/api/v1' + path + '"\nheader = "Authorization: Bearer ' + key + '"\nheader = "Content-Type: application/json"\n'
    command = ['curl', '--max-time', '40', '--silent', '--show-error', '--config', '-']
    if body is not None: command += ['--data-binary', json.dumps(body)]
    r = subprocess.run(command, input=config, text=True, capture_output=True)
    if r.returncode: return {'code': 0, 'msg': 'Transport outcome unknown'}
    try: return json.loads(r.stdout)
    except ValueError: return {'code': 0, 'msg': 'Response outcome unknown'}

def download(job):
    path, data = job
    if data.get('status') == 'downloaded': return
    task = data.get('response', {}).get('data', {}).get('taskId')
    if not task: return
    result = request('/generate/record-info?taskId=' + task)
    data['result'] = result
    state = result.get('data', {}).get('status') if isinstance(result.get('data'), dict) else None
    if state == 'SUCCESS':
        tracks = result['data']['response']['sunoData']; checked = []
        for index, track in enumerate(tracks):
            url = track.get('audio_url')
            if not isinstance(url, str) or not url.startswith('https://'): raise RuntimeError('Expected an HTTPS generated file')
            file = root / (data['playlist'] + '-' + str(data['slot'] + 1).zfill(2) + '-' + str(index + 1) + '.mp3')
            if not file.exists():
                partial = file.with_suffix('.part')
                subprocess.run(['curl', '--max-time', '90', '--max-filesize', '20971520', '--fail', '--silent', '--show-error', '--output', str(partial), url], check=True)
                os.replace(partial, file)
            probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration,size:stream=codec_name,sample_rate,channels', '-of', 'json', str(file)]))
            duration = float(probe['format']['duration'])
            valid = 150 <= duration <= 360 and all(s['codec_name'] == 'mp3' for s in probe['streams'])
            metrics = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(file), '-af', 'volumedetect,silencedetect=noise=-45dB:d=3', '-f', 'null', '-'], capture_output=True, text=True)
            lines = [line for line in metrics.stderr.splitlines() if any(k in line for k in ['mean_volume:', 'max_volume:', 'silence_start:', 'silence_end:'])]
            checked.append({'providerId': track['id'], 'file': str(file), 'title': track['title'] + ' · ' + str(index + 1), 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'duration': duration, 'bytes': file.stat().st_size, 'structurallyValid': valid, 'audioMetrics': lines, 'listeningReview': 'pending'})
        data['tracks'] = checked; data['status'] = 'downloaded'
    elif state and any(x in state for x in ['FAIL', 'ERROR', 'SENSITIVE']): data['status'] = 'failed'
    write(path, data)
    print(json.dumps({'playlist': data['playlist'], 'slot': data['slot'], 'status': data['status']}), flush=True)

for round_no in range(max(1, min(args.rounds, 120))):
    jobs = [(p, json.loads(p.read_text())) for p in sorted(root.glob('*-intent.json'))]
    pending = [(p, d) for p, d in jobs if d.get('status') == 'pending']
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(download, pending))
    jobs = [(p, json.loads(p.read_text())) for p in sorted(root.glob('*-intent.json'))]
    active = sum(d.get('status') in ['pending', 'submitting', 'unknown'] for _, d in jobs)
    if args.submit and active < args.concurrency:
        remaining = [b for b in briefs if not (root / (b['playlist'] + '-' + str(b['slot']).zfill(2) + '-intent.json')).exists()]
        for brief in remaining[:max(0, args.concurrency-active)]:
            if len(jobs) >= args.max_requests or (len(jobs)+1) * args.credits_per_request > args.credit_budget: break
            credits = request('/generate/credit')
            if credits.get('code') != 200 or float(credits['data']) < args.credits_per_request: raise SystemExit('Credit check did not permit another request')
            body = {k:v for k,v in brief.items() if k not in ['playlist', 'slot']}
            body.update(customMode=True, instrumental=True, model='V6', variety=1, negativeTags='vocals, singing, speech, lyrics, spoken word, crowd chanting, clipping, abrupt silence', callBackUrl=args.origin.rstrip('/') + '/api/v1/public/music/callback')
            path = root / (brief['playlist'] + '-' + str(brief['slot']).zfill(2) + '-intent.json')
            data = {'playlist': brief['playlist'], 'slot': brief['slot'], 'status': 'submitting', 'creditsBefore': credits['data'], 'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'request': body}
            # Exclusive intent creation prevents concurrent builders double-submitting.
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w') as f: json.dump(data, f); f.flush(); os.fsync(f.fileno())
            result = request('/generate', body); data['response'] = result
            task = result.get('data', {}).get('taskId') if isinstance(result.get('data'), dict) else None
            data['status'] = 'pending' if task else 'failed' if result.get('code') in [400,401,402,403,404,422,429] else 'unknown'
            write(path, data); jobs.append((path, data))
            print(json.dumps({'playlist': brief['playlist'], 'slot': brief['slot'], 'status': data['status']}), flush=True)
            if data['status'] != 'pending': raise SystemExit('Submission needs review before further generation')
    if round_no + 1 < args.rounds: time.sleep(15)

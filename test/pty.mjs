import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// macOS integration helper: drive each prompt only after it appears, as a Terminal user does.
export async function terminal(argv,steps,{env={},cwd,timeout=15000}={}){
  const program=`import errno, json, os, pty, select, subprocess, sys, time
options = json.loads(sys.argv[1])
master, slave = pty.openpty()
environment = dict(os.environ)
environment.update(options['env'])
child = subprocess.Popen(options['argv'], stdin=slave, stdout=slave, stderr=slave, env=environment, cwd=options.get('cwd'))
os.close(slave)
output = b''
step = 0
cursor = 0
deadline = time.monotonic() + options['timeout'] / 1000
try:
    while time.monotonic() < deadline:
        if select.select([master], [], [], 0.05)[0]:
            try: data = os.read(master, 65536)
            except OSError as error:
                if error.errno == errno.EIO: break
                raise
            if not data: break
            output += data
            while step < len(options['steps']):
                current = options['steps'][step]
                marker = current['wait'].encode()
                position = output.find(marker, cursor)
                if position < 0: break
                cursor = position + len(marker)
                time.sleep(current.get('delay_ms', 0) / 1000)
                os.write(master, current['send'].encode())
                step += 1
        elif child.poll() is not None: break
    if child.poll() is None:
        try: child.wait(timeout=1)
        except subprocess.TimeoutExpired:
            child.kill()
            raise RuntimeError('Terminal timed out at prompt ' + str(step))
    print(json.dumps({'code':child.wait(), 'output':output.decode(errors='replace'), 'steps':step}))
finally:
    os.close(master)
    if child.poll() is None: child.kill()
`;
  const {stdout}=await promisify(execFile)('/usr/bin/python3',['-c',program,JSON.stringify({argv,steps,env,cwd,timeout})],{timeout:timeout+3000,maxBuffer:2_000_000});
  return JSON.parse(stdout);
}

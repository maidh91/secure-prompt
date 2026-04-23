// Reproduces the flaky hang: secure-prompt creates a uv_tty_t handle on fd 0
// even when fd 0 is a pipe. On some Node.js versions uv_read_start on a TTY
// handle backed by a pipe never fires the read callback, so the prompt hangs.
//
// Run this many times:  for i in $(seq 50); do node test/pipe-stdin.js || break; done
// Or: node test/pipe-stdin.js --iterations 100

const { spawn } = require('child_process')
const path = require('path')
const assert = require('assert')

const SUBJECT = path.join(__dirname, 'subject.js')
const PASSWORD = 'testpassword123'
const TIMEOUT_MS = 3000

const iterations = (() => {
  const idx = process.argv.indexOf('--iterations')
  return idx !== -1 ? parseInt(process.argv[idx + 1], 10) : 20
})()

async function runOnce (n) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SUBJECT], {
      stdio: ['pipe', 'pipe', 'inherit']
    })

    let stdout = ''
    let done = false

    const timer = setTimeout(() => {
      done = true
      child.kill('SIGKILL')
      reject(new Error(
        `iteration ${n}: child hung after ${TIMEOUT_MS}ms — ` +
        'secure-prompt did not deliver pipe data to onread callback (uv_tty_t on pipe fd)'
      ))
    }, TIMEOUT_MS)

    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })

    child.on('exit', (code, signal) => {
      if (done) return
      done = true
      clearTimeout(timer)

      if (signal) return reject(new Error(`iteration ${n}: child killed by signal ${signal}`))
      if (code !== 0) return reject(new Error(`iteration ${n}: child exited with code ${code}`))

      const received = stdout.trim()
      try {
        assert.strictEqual(received, PASSWORD,
          `iteration ${n}: password mismatch — got "${received}"`)
      } catch (err) {
        return reject(err)
      }

      console.log(`  [${n}/${iterations}] ok`)
      resolve()
    })

    // Write the password into the pipe. The data sits in the OS pipe buffer
    // until the child's libuv event loop reads it. If secure-prompt's uv_tty_t
    // handle never fires onread for pipe data, the child hangs and we time out.
    child.stdin.write(PASSWORD + '\n')
    child.stdin.end()
  })
}

async function main () {
  console.log(`Running ${iterations} iterations (timeout ${TIMEOUT_MS}ms each)`)
  console.log(`Node.js ${process.version}\n`)

  for (let i = 1; i <= iterations; i++) {
    await runOnce(i)
  }

  console.log(`\nAll ${iterations} iterations passed.`)
}

main().catch((err) => {
  console.error('\nFAIL:', err.message)
  process.exit(1)
})

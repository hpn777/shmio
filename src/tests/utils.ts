function bench(name: string, count: number, test: (c: number) => any) {
  const start = process.hrtime.bigint()
  const result = test(count)
  const total = process.hrtime.bigint() - start

  console.log(
    `${name}
    ns/itr: ${total / BigInt(count)}
    result:`,
    result
  )
}

const Measurer = () => {
  let lastTime = Date.now()
  let totalCount = 0

  const add = (num: number) => {
    totalCount += num
  }

  const sample = () => {
    const currentTime = Date.now()

    const timeDiff = currentTime - lastTime

    // in events per second
    const result = (totalCount / timeDiff) * 1000

    lastTime = currentTime
    totalCount = 0

    return `${Math.round(result)}/s`
  }

  return {
    add,
    sample,
  }
}

function execShellCommand(cmd: string) {
  const exec = require('child_process').exec
  return new Promise((resolve, reject) => {
    exec(cmd, (error?: string, stdout?: string, stderr?: string) => {
      if (error) {
        console.warn(error)
      }
      resolve(stdout ? stdout : stderr)
    })
  })
}

export { bench, Measurer, execShellCommand }

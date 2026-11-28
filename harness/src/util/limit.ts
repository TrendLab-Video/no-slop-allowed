// Tiny concurrency limiter. fal caps concurrent requests per account (starts at 2),
// so every fal call goes through one shared limiter instead of failing with 429s.

export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>

export function createLimiter(max: number): Limiter {
  let active = 0
  const queue: Array<() => void> = []

  const next = () => {
    if (active >= max) return
    const start = queue.shift()
    if (start) start()
  }

  return <T>(fn: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      const start = () => {
        active++
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--
            next()
          })
      }
      queue.push(start)
      next()
    })
}

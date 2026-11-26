// Preloaded before any test file (see bunfig.toml), so config.ts reads these
// before it is imported. Tests must never hit live fal, even with FAL_KEY in .env.
process.env.MOCK = '1'
process.env.FAL_KEY = ''
process.env.QUIET = '1'
process.env.RUNS_DIR = '.test-runs'

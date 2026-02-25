import { z } from 'zod'

// Keep CSP strict by disabling Zod v4 JIT (uses Function/eval under the hood).
z.config({ jitless: true })


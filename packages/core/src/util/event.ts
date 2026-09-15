import { EventEmitter } from 'node:events'
import type { WorkerEvent } from '../orchestrator/worker.ts'

export type AppEvent = {
    'worker:event': [event: WorkerEvent]
}

export const globalEventBus = new EventEmitter<AppEvent>()

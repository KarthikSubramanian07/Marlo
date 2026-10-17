import { parentPort, workerData } from 'node:worker_threads';
import { StaticRenderer } from '@trymarlo/render';
import { peerEngines } from '@trymarlo/engines';
import { MarloEngine } from './marlo-engine.js';
import { evaluatePage, type WorkerJob } from './real-pool.js';

/**
 * Worker entry point for one engine on one real page. No logic: it builds the engine the
 * job names, calls `evaluatePage`, and posts the result once. The parent owns the clock
 * and terminates this thread when the cap passes.
 *
 * Every engine is constructed the same way the main harness constructs it, from the same
 * list, so no engine is set up differently inside a worker than outside one.
 */

const job = workerData as WorkerJob;
const engine = [new MarloEngine(), ...peerEngines()].find((e) => e.id === job.engine);
if (engine === undefined) throw new Error(`no engine with id ${job.engine}`);

const renderer = new StaticRenderer();
const evaluation = await evaluatePage(engine, renderer, job, job.rules);
parentPort?.postMessage({ results: evaluation.results });
await renderer.dispose();

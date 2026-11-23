import { Limiter } from './src/limiter.js';
let ctor = 'none'; let g: any;
try { g = new (Limiter as any)(); g.check('a', 'b'); } catch { ctor = 'empty'; g = new (Limiter as any)({}); }
const allowed = g.check('1.1.1.1', '+254700000001');
for (let i = 0; i < 10; i++) g.fail('1.1.1.1', '+254700000001');
const blocked = g.check('1.1.1.1', '+254700000001');
console.log(JSON.stringify({ ctor, allowed, blocked }));

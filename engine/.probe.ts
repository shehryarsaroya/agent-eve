import { classifyAction, commonsFloorRejection, assertVerbsClassified, VERB_CLASS } from './src/world/index.js';

const protoKeys = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__', 'isPrototypeOf', 'toLocaleString', 'propertyIsEnumerable'];
for (const k of protoKeys) {
  const r = classifyAction(k) as unknown;
  console.log(`classifyAction(${JSON.stringify(k)}) ->`, typeof r, JSON.stringify(String(r)).slice(0, 60), '| ===HOSTILE?', r === 'HOSTILE');
}
console.log('--- assertVerbsClassified totality hole ---');
try {
  assertVerbsClassified([...Object.keys(VERB_CLASS), 'constructor']);
  console.log('assertVerbsClassified([...spec, "constructor"]) DID NOT THROW  <-- hole');
} catch (e) { console.log('threw:', (e as Error).message.slice(0,120)); }

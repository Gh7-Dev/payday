import bs58 from 'bs58';

export interface ParsedTx {
  signatures: Uint8Array[];
  numRequiredSignatures: number;
  accountKeys: string[]; // base58
  programIds: string[]; // base58, one per instruction
  messageBytes: Uint8Array;
}

function readCompact(buf: Uint8Array, off: number): [number, number] {
  let value = 0;
  for (let i = 0; i < 3; i++) {
    if (off + i >= buf.length) throw new Error('truncated');
    const b = buf[off + i];
    value |= (b & 0x7f) << (7 * i);
    if ((b & 0x80) === 0) return [value, off + i + 1];
  }
  throw new Error('bad_compact');
}

// Solana wire format: legacy or v0 message. Lookup tables are ignored (program IDs are always static keys).
export function parseTransaction(bytes: Uint8Array): ParsedTx {
  const len = bytes.length;
  let off = 0;
  let nSig: number;
  [nSig, off] = readCompact(bytes, off);
  if (nSig < 1 || nSig > 16) throw new Error('bad_signature_count');
  if (off + nSig * 64 > len) throw new Error('truncated');
  const signatures: Uint8Array[] = [];
  for (let i = 0; i < nSig; i++) signatures.push(bytes.slice(off + i * 64, off + (i + 1) * 64));
  off += nSig * 64;
  const messageStart = off;
  if (off >= len) throw new Error('truncated');
  if (bytes[off] & 0x80) {
    if ((bytes[off] & 0x7f) !== 0) throw new Error('unsupported_version');
    off++;
  }
  if (off + 3 > len) throw new Error('truncated');
  const numRequiredSignatures = bytes[off];
  off += 3;
  let nKeys: number;
  [nKeys, off] = readCompact(bytes, off);
  if (nKeys < 1 || nKeys > 64 || off + nKeys * 32 > len) throw new Error('bad_keys');
  const accountKeys: string[] = [];
  for (let i = 0; i < nKeys; i++) accountKeys.push(bs58.encode(bytes.slice(off + i * 32, off + (i + 1) * 32)));
  off += nKeys * 32;
  if (off + 32 > len) throw new Error('truncated');
  off += 32; // recent blockhash
  let nIx: number;
  [nIx, off] = readCompact(bytes, off);
  if (nIx < 1 || nIx > 32) throw new Error('bad_instruction_count');
  const programIds: string[] = [];
  for (let i = 0; i < nIx; i++) {
    if (off >= len) throw new Error('truncated');
    const pi = bytes[off++];
    if (pi >= nKeys) throw new Error('bad_program_index');
    let nAcc: number;
    [nAcc, off] = readCompact(bytes, off);
    off += nAcc;
    if (off > len) throw new Error('truncated');
    let nData: number;
    [nData, off] = readCompact(bytes, off);
    off += nData;
    if (off > len) throw new Error('truncated');
    programIds.push(accountKeys[pi]);
  }
  if (numRequiredSignatures !== nSig) throw new Error('signature_count_mismatch');
  return { signatures, numRequiredSignatures, accountKeys, programIds, messageBytes: bytes.slice(messageStart) };
}

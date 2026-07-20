import initSqlJs from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

import type { ApiSessionData } from '../api/types';

import { DC_IDS } from '../config';
import { bufferToHex } from './encoding/buffer';

const AUTH_KEY_LENGTH = 256;
const MAX_SESSION_FILE_SIZE = 10 * 1024 * 1024;
const SESSION_QUERY = `
  SELECT dc_id, server_address, auth_key
  FROM sessions
  WHERE auth_key IS NOT NULL
  LIMIT 1
`;
const TEST_SERVER_ADDRESSES = new Set([
  '149.154.167.40',
  '149.154.175.10',
  '149.154.175.117',
]);

let sqlJsPromise: ReturnType<typeof initSqlJs> | undefined;

export async function parseTelethonSession(file: File): Promise<ApiSessionData> {
  if (file.size > MAX_SESSION_FILE_SIZE) {
    throw new Error('Telethon session file is too large');
  }

  const sqlJs = await loadSqlJs();
  const sessionBytes = new Uint8Array(await file.arrayBuffer());
  const database = new sqlJs.Database(sessionBytes);

  try {
    const result = database.exec(SESSION_QUERY)[0];
    const row = result?.values[0];
    if (!row) {
      throw new Error('Telethon session row not found');
    }

    const [dcId, serverAddress, authKey] = row;
    if (typeof dcId !== 'number' || !DC_IDS.some((knownDcId) => knownDcId === dcId)) {
      throw new Error('Invalid Telethon data center');
    }

    if (!(authKey instanceof Uint8Array) || authKey.length !== AUTH_KEY_LENGTH) {
      throw new Error('Invalid Telethon authorization key');
    }

    const isTest = typeof serverAddress === 'string' && TEST_SERVER_ADDRESSES.has(serverAddress)
      ? true
      : undefined;

    return {
      mainDcId: dcId,
      keys: {
        [dcId]: bufferToHex(authKey),
      },
      isTest,
    };
  } finally {
    database.close();
  }
}

function loadSqlJs() {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({
      locateFile: () => sqlWasmUrl,
    });
  }

  return sqlJsPromise;
}

'use strict';

const fs = require('node:fs');
const { Client } = require('pg');

const ROLE_NAME = 'laboratory_management_system_user';

async function setLocalDatabaseRolePassword({ operation, password, ClientClass = Client }) {
  if (operation !== 'CREATE' && operation !== 'ALTER') {
    throw new Error('Invalid local database role operation.');
  }
  if (!password || password.includes('\0') || /[\r\n]/.test(password)) {
    throw new Error('The managed local database password is empty or invalid.');
  }

  const client = new ClientClass({
    user: 'postgres',
    database: 'postgres',
    host: '/var/run/postgresql'
  });
  await client.connect();
  try {
    const formatted = await client.query(
      `select format('${operation} ROLE ${ROLE_NAME} WITH LOGIN PASSWORD %L', $1::text) as sql`,
      [password]
    );
    const statement = String(formatted.rows?.[0]?.sql || '');
    const expectedPrefix = `${operation} ROLE ${ROLE_NAME} WITH LOGIN PASSWORD `;
    if (!statement.startsWith(expectedPrefix)) {
      throw new Error('PostgreSQL did not return the expected role statement.');
    }
    await client.query(statement);
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  const operation = String(process.argv[2] || '').trim().toUpperCase();
  const password = fs.readFileSync(0, 'utf8');
  await setLocalDatabaseRolePassword({ operation, password });
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { setLocalDatabaseRolePassword };

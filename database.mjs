import {AsyncLocalStorage} from 'node:async_hooks';
import {Pool} from 'pg';
import pg from 'pg';
import {attachDatabasePool} from '@vercel/functions';

const contexts=new AsyncLocalStorage();
pg.types.setTypeParser(20, value => Number(value));
const databaseUrl=process.env.DATABASE_URL;
const pool=databaseUrl?new Pool({connectionString:databaseUrl,max:5,idleTimeoutMillis:5000,connectionTimeoutMillis:10000}):null;
if(pool&&process.env.VERCEL)attachDatabasePool(pool);

export const isPostgres=!!pool;
export const databaseContext=fn=>contexts.run({client:null},fn);

async function pgQuery(sql,values=[]){
  const client=contexts.getStore()?.client;
  return (client||pool).query(sql,values);
}

function postgresSql(sql){
  let n=0;
  return sql.replace(/\?/g,()=>`$${++n}`).replace(/strftime\('%Y-%m-%d %H:%M:%f','now'\)/gi,"TO_CHAR(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS.MS')");
}

export const db=pool?{
  async exec(sql){
    const context=contexts.getStore();
    const command=sql.trim().replace(/;\s*$/,'').toUpperCase();
    if(command==='BEGIN'){
      if(!context)throw new Error('Database transaction requires a request context.');
      context.client=await pool.connect();
      try{return await context.client.query('BEGIN');}catch(error){context.client.release();context.client=null;throw error;}
    }
    if(command==='COMMIT'||command==='ROLLBACK'){
      if(!context?.client)return;
      const client=context.client;context.client=null;
      try{return await client.query(command);}finally{client.release();}
    }
    return pool.query(sql);
  },
  async close(){await pool.end();},
}:null;

export async function all(dbInstance,sql,...args){
  if(pool)return (await pgQuery(postgresSql(sql),args)).rows;
  return dbInstance.prepare(sql).all(...args);
}

export async function one(dbInstance,sql,...args){
  if(pool)return (await pgQuery(postgresSql(sql),args)).rows[0];
  return dbInstance.prepare(sql).get(...args);
}

export async function run(dbInstance,sql,...args){
  if(!pool)return dbInstance.prepare(sql).run(...args);
  let statement=sql.replace(/INSERT OR IGNORE INTO/i,'INSERT INTO');
  const ignored=/INSERT OR IGNORE INTO/i.test(sql);
  if(ignored)statement+=' ON CONFLICT DO NOTHING';
  const hasResult=/^\s*INSERT\s+INTO\s+(?:users|courses|lessons|questions|attempts|submissions)\b/i.test(statement);
  if(hasResult&&!/\bRETURNING\b/i.test(statement)&&!ignored)statement+=' RETURNING id';
  const result=await pgQuery(postgresSql(statement),args);
  return {lastInsertRowid:result.rows[0]?.id===undefined?undefined:Number(result.rows[0].id),changes:result.rowCount};
}

export async function closeDatabase(sqliteDb){
  if(pool)await pool.end();
  else sqliteDb.close();
}

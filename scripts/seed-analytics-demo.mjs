// An explicit, repeatable educational cohort. Never represents real employees.
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,scryptSync} from 'node:crypto';
import {all,one,run,db,isPostgres,databaseContext,closeDatabase} from '../database.mjs';
import {pathToFileURL} from 'node:url';

export async function seedAnalyticsDemo(store,{asOf='2026-10-23'}={}) {
  const query=(sql,...args)=>all(store,sql,...args);
  const first=(sql,...args)=>one(store,sql,...args);
  const write=(sql,...args)=>run(store,sql,...args);
  const courses=await query('SELECT id FROM courses WHERE published=1 ORDER BY id');
  if(courses.length<6)throw new Error('Six published courses are required.');
  const names=['Алишер Рахимов','Мадина Юсупова','Бехзод Турсунов','Нигина Абдуллаева','Жасур Мирзаев','Шахноза Исмаилова','Сардор Рустамов','Дилфуза Нурматова','Отабек Хамидов','Камола Саидова','Фаррух Эргашев','Севара Усманова','Равшан Хакимов','Зарина Махмудова','Дониёр Собиров','Малика Каримова','Улугбек Абдурахмонов','Нодира Ахмедова','Ислом Назаров','Феруза Рахманова','Шерзод Азимов','Лола Шарипова','Акмал Ходжаев','Гулноза Олимова'];
  const departments=['Разработка','Инфраструктура','Поддержка','Информационная безопасность'];
  const at=(days,hour=9)=>{const d=new Date(asOf+'T00:00:00Z');if(!Number.isFinite(d.getTime()))throw new Error('Invalid date.');d.setUTCDate(d.getUTCDate()-days);d.setUTCHours(hour);return d.toISOString();};
  const result={kind:'modelled-educational-cohort',as_of:asOf,created_users:0,skipped_users:0,enrollments:0,completions:0,attempts:0,eligible_certificates:0};
  await store.exec('BEGIN');
  try{
    for(let i=0;i<names.length;i++){
      const email=`cohort-${String(i+1).padStart(2,'0')}@cohort.academy.test`;
      if(await first('SELECT id FROM users WHERE email=?',email)){result.skipped_users++;continue;}
      // Random, undisclosed passwords: these records are for reporting, not demo login buttons.
      const salt=randomBytes(16).toString('hex'),password=randomBytes(32).toString('hex');
      const hash=salt+':'+scryptSync(password,salt,64).toString('hex');
      const uid=Number((await write('INSERT INTO users(name,email,password_hash,role,department,created_at) VALUES(?,?,?,?,?,?)',names[i],email,hash,'student',departments[i%4],at(27))).lastInsertRowid);
      result.created_users++;
      for(let j=0;j<2+i%3;j++){
        const cid=courses[(i+j)%courses.length].id;
        const lessons=await query('SELECT id FROM lessons WHERE course_id=? ORDER BY position',cid);
        const questions=await query('SELECT id,prompt,options,correct,explanation FROM questions WHERE course_id=? ORDER BY id',cid);
        const stage=(i*3+j*2)%7,complete=stage>=3,done=complete?lessons.length:stage===0?0:Math.min(stage,lessons.length-1);
        const daysAgo=1+(i*5+j*3)%19;
        await write('INSERT INTO enrollments(user_id,course_id,assigned_at) VALUES(?,?,?)',uid,cid,at(24-i%5));result.enrollments++;
        for(let k=0;k<done;k++){await write('INSERT INTO completions(user_id,lesson_id,completed_at) VALUES(?,?,?)',uid,lessons[k].id,at(daysAgo,8+k));result.completions++;}
        if(!complete||!questions.length)continue;
        const scores=stage===3?[2]:stage===4?[3]:stage===5?[2,4]:[4];
        for(let t=0;t<scores.length;t++){
          const correctCount=Math.min(scores[t],questions.length);
          const details=questions.map((q,k)=>({id:q.id,prompt:q.prompt,options:JSON.parse(q.options),selected:k<correctCount?q.correct:(q.correct+1)%JSON.parse(q.options).length,correct:q.correct,explanation:q.explanation,ok:k<correctCount}));
          const score=Math.round(correctCount/questions.length*100);
          await write('INSERT INTO attempts(user_id,course_id,score,passed,details,created_at) VALUES(?,?,?,?,?,?)',uid,cid,score,score>=75?1:0,JSON.stringify(details),at(Math.max(0,daysAgo-t),14+t));result.attempts++;
        }
        if(stage>=4)result.eligible_certificates++;
      }
    }
    await store.exec('COMMIT');return result;
  }catch(error){await store.exec('ROLLBACK');throw error;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(!process.argv.includes('--apply'))throw new Error('Use --apply to add the explicitly labelled educational cohort. Existing users are preserved.');
  if(!isPostgres&&!process.env.DB_PATH)throw new Error('Set DB_PATH or DATABASE_URL explicitly.');
  const store=isPostgres?db:new DatabaseSync(process.env.DB_PATH);
  try{console.log(JSON.stringify(await databaseContext(()=>seedAnalyticsDemo(store)),null,2));}finally{await closeDatabase(store);}
}

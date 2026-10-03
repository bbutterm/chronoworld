import { deserialize } from '../src/core';
import { commit, session, today, now } from '../src/game/session';
const fixtures = import.meta.glob('./fixtures/*.json', { eager: true, import: 'default' });
const labels = {
  'cap3-four-choices': 'Load synthetic Tower scenario: cap 3 / paid 4 choices / четвертая MVP',
  'scribe-event-cap3': 'Load synthetic Tower scenario: Писарь при полном лимите MVP',
  'scribe-pending-cap3': 'Load synthetic Tower scenario: предложение Писаря / четыре варианта',
  'osiris-first-acquisition': 'Load synthetic Tower scenario: Осирис впервые / павший герой',
  'osiris-already-spent': 'Load synthetic Tower scenario: Осирис повторно / эффект уже потрачен',
  'empty-exchange-pool': 'Load synthetic Tower scenario: исчерпанный пул обмена',
  'legacy-over-cap': 'Load synthetic Tower scenario: старый забег сверх лимита',
};
const consent = document.querySelector('#qa-consent');
const status = document.querySelector('#qa-status');
function inspect() {
 const r=session.save.tower.run;
 document.querySelector('#qa-summary').textContent=JSON.stringify({syntheticQA:true,floor:r?.floor,cards:r?.cards,rerolls:r?.rerolls,fallen:r?.fallen,consumedImmediateCards:r?.consumedImmediateCards,draftRules:r?.draftRules,pending:r?.pending,upgrades:session.save.tower.upgrades},null,2);
}
for (const [id,label] of Object.entries(labels)) {
 const button=document.createElement('button');button.id=`qa-load-${id}`;button.textContent=label;button.disabled=true;
 button.addEventListener('click',()=>{
  if(!consent.checked)return;
  try {
   const data=structuredClone(fixtures[`./fixtures/${id}.json`]);
   data.createdAt=now();data.offline.lastClaimAt=now();data.daily.day=today();
   const save=deserialize(JSON.stringify(data));commit(save);
   if(JSON.stringify(session.save.tower.run)!==JSON.stringify(save.tower.run))throw new Error('Запись не принята. Закройте другие вкладки и обновите страницу.');
   status.textContent=`Загружен синтетический сценарий: ${id}. Откройте игру по ссылке ниже.`;inspect();
  } catch(error){status.textContent=`Ошибка: ${error.message}`;}
 });document.querySelector('#qa-scenarios').append(button);
}
consent.addEventListener('change',()=>{document.querySelectorAll('#qa-scenarios button').forEach(b=>b.disabled=!consent.checked);});
document.querySelector('#qa-inspect').addEventListener('click',inspect);inspect();

// Re-open through normal navigation with fresh storage/session after game changes.
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});

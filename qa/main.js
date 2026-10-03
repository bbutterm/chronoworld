import { deserialize, resolveStageEnemies, huntStatus } from '../src/core';
import { GAME } from '../src/game/content';
import { commit, session, today, now } from '../src/game/session';
const fixtures = import.meta.glob('./fixtures/*.json', { eager: true, import: 'default' });
const labels = {
  'tower-new-card-art': 'Load synthetic Tower scenario: новые карты Sidewinder, Marse, Sohee',
  'hunt-rank5': 'Load synthetic Hunt scenario: MVP уровень 5 / попытки и босс дня',
  'hunt-max-rank': 'Load synthetic Hunt scenario: максимальный уровень MVP',
  'chapter3-pilot-choice': 'Load synthetic story scenario: выбор главы 3 после ch3_s15',
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
 const nextStage=GAME.content.stages.find(stage=>!session.save.campaign.cleared.includes(stage.id));
 const stagePreview=nextStage ? {id:nextStage.id,name:nextStage.name,enemies:resolveStageEnemies(nextStage,session.save.campaignChoices).map(enemy=>enemy ? {...enemy,name:GAME.content.units[enemy.unit]?.name} : null)}:null;
 const huntView=huntStatus(session.save,today(),GAME);
 document.querySelector('#qa-summary').textContent=JSON.stringify({syntheticQA:true,nextStage:stagePreview,huntDisplay:{rank:huntView.rank+1,ranks:huntView.ranks,attemptsLeft:huntView.attemptsLeft,boss:huntView.boss.def.name},floor:r?.floor,cards:r?.cards,rerolls:r?.rerolls,fallen:r?.fallen,consumedImmediateCards:r?.consumedImmediateCards,draftRules:r?.draftRules,pending:r?.pending,upgrades:session.save.tower.upgrades,hunt:session.save.hunt,storyQueue:session.save.storyQueue,campaignChoices:session.save.campaignChoices,campaign:session.save.campaign,seenScenes:session.save.seenScenes},null,2);
}
for (const [id,label] of Object.entries(labels)) {
 const button=document.createElement('button');button.id=`qa-load-${id}`;button.textContent=label;button.disabled=true;
 button.addEventListener('click',()=>{
  if(!consent.checked)return;
  try {
   const data=structuredClone(fixtures[`./fixtures/${id}.json`]);
   data.createdAt=now();data.offline.lastClaimAt=now();data.daily.day=today();
   if(data.hunt)data.hunt.day=today();
   const save=deserialize(JSON.stringify(data));commit(save);
   if(['tower','hunt','storyQueue','campaignChoices','campaign'].some(key=>JSON.stringify(session.save[key])!==JSON.stringify(save[key])))throw new Error('Запись не принята. Закройте другие вкладки и обновите страницу.');
   status.textContent=`Загружен синтетический сценарий: ${id}. Откройте игру по ссылке ниже.`;inspect();
  } catch(error){status.textContent=`Ошибка: ${error.message}`;}
 });document.querySelector('#qa-scenarios').append(button);
}
consent.addEventListener('change',()=>{document.querySelectorAll('#qa-scenarios button').forEach(b=>b.disabled=!consent.checked);});
document.querySelector('#qa-inspect').addEventListener('click',inspect);inspect();

// Re-open through normal navigation with fresh storage/session after game changes.
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});

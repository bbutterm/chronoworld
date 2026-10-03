import { deserialize } from '../src/core';
import { commit, session, today, now } from '../src/game/session';
const fixtures=import.meta.glob('./fixtures/*.json',{eager:true,import:'default'});
const labels={
 'detail-first':'Load synthetic first-profession squad: Alan, Kai, Bran, Greta',
 'detail-promoted-a':'Load unchanged promoted forms: Knight, Wizard, Hunter, Blacksmith',
 'detail-promoted-b':'Load unchanged alternate forms: Crusader, Sage, Bard, Alchemist',
};
const consent=document.querySelector('#qa-consent');
const status=document.querySelector('#qa-status');
function inspect(){document.querySelector('#qa-summary').textContent=JSON.stringify({syntheticQA:true,clearedStages:session.save.campaign.cleared.length,heroes:session.save.heroes.map(h=>({id:h.id,templateId:h.templateId,level:h.level,rarity:h.rarity,branch:h.branch})),expeditions:session.save.expeditions},null,2);}
for(const [id,label] of Object.entries(labels)){
 const button=document.createElement('button');button.id=`qa-load-${id}`;button.textContent=label;button.disabled=true;
 button.addEventListener('click',()=>{
  if(!consent.checked)return;
  try{
   const data=structuredClone(fixtures[`./fixtures/${id}.json`]);data.createdAt=now();data.offline.lastClaimAt=now();data.daily.day=today();
   const save=deserialize(JSON.stringify(data));commit(save);
   if(JSON.stringify(session.save.heroes)!==JSON.stringify(save.heroes))throw new Error('Synthetic save was not accepted. Close other preview tabs and reload.');
   status.textContent=`Loaded synthetic fixture: ${id}. Open the game below.`;inspect();
  }catch(error){status.textContent=`Error: ${error.message}`;}
 });document.querySelector('#qa-scenarios').append(button);
}
consent.addEventListener('change',()=>{document.querySelectorAll('#qa-scenarios button').forEach(b=>b.disabled=!consent.checked);});
document.querySelector('#qa-inspect').addEventListener('click',inspect);inspect();
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});

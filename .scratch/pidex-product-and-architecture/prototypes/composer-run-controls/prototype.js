const variants={A:"Intent beside submit",B:"Two-lane composer",C:"Contextual default",D:"Selected behavior"};
const states=["quiet","executing","queued","held","offline","uncertain"];
const params=new URLSearchParams(location.search);
let variant=variants[params.get("variant")]?params.get("variant"):"A";
let state=states.includes(params.get("state"))?params.get("state"):"executing";
let intent="steer";
let draft="";

const surface=document.querySelector("#control-surface");
const switcher=document.querySelector("#switcher");
const stateCopy={quiet:"Run 18 completed · draft saved on this Device",executing:"Run 18 executing · exact target",queued:"Run 18 executing · 1 follow-up queued",held:"Run 18 interrupted · follow-up held",offline:"Offline · last authoritative sync 4m ago",uncertain:"Submission sent · confirming receipt…"};

function controls(){
  const stop=state==="executing"||state==="queued"?`<button class="stop" data-action="stop">■ Stop Run 18</button>`:"";
  const held=state==="held"?`<div class="held"><b>Follow-up held</b><span>Its predecessor was interrupted.</span><button class="secondary" data-action="release">Release</button><button class="secondary" data-action="cancel">Cancel</button></div>`:"";
  const notice=state==="offline"?`<div class="notice">Cached Timeline. Draft editing remains available; Host actions wait for reconciliation.</div>`:state==="uncertain"?`<div class="notice">Do not resubmit. Pidex is checking the original Command receipt.</div>`:"";
  const disabled=state==="offline"||state==="uncertain"?"disabled":"";
  if(variant==="D"){
    const executing=state==="executing"||state==="queued";
    const primary=executing&&!draft?`<button class="send" data-action="stop" ${disabled}>■</button>`:`<button class="send" ${disabled}>↑</button>`;
    const queuedSteering=state==="queued"?`<div class="notice">1 steering message waiting to be delivered</div>`:"";
    return `${held}${notice}${queuedSteering}<div class="composer"><textarea data-draft placeholder="${executing?"Steer the work in progress…":"Start the next Run…"}">${draft}</textarea><div class="row"><select title="Model for next Run"><option>Next: GPT-5.3 Codex</option></select><select title="Mode for next Run"><option>Next: Code</option><option>Next: Plan</option></select>${primary}</div></div>`;
  }
  if(variant==="B") return `${held}${notice}<div class="status"><span>${stateCopy[state]}</span>${stop}</div><div class="lanes"><div class="lane"><h3>Steer Run 18</h3><textarea placeholder="Adjust the work in progress…"></textarea><div class="row"><small>Targets only Run 18</small><button class="send" ${disabled}>↑</button></div></div><div class="lane"><h3>Queue follow-up</h3><textarea placeholder="What should happen next?"></textarea><div class="row"><small>Starts after Run 18</small><button class="send" ${disabled}>↑</button></div></div></div>`;
  if(variant==="C") return `${held}${notice}<div class="status"><span>${stateCopy[state]}</span>${stop}</div><div class="composer"><div class="default-label">${state==="executing"||state==="queued"?"Sending will steer Run 18":"Sending will start a new Run"}</div><textarea placeholder="Ask for a change or follow up…"></textarea><div class="row"><button class="pill" data-action="intent">${intent==="steer"?"↳ Steer Run 18":"＋ Queue follow-up"}⌄</button><select><option>GPT-5.3 Codex</option></select><select><option>Code</option><option>Plan</option></select><button class="send" ${disabled}>↑</button></div></div>`;
  return `${held}${notice}<div class="status"><span>${stateCopy[state]}</span>${stop}</div><div class="composer"><textarea placeholder="Ask for a change or follow up…"></textarea><div class="row"><select data-action="intent"><option value="steer" ${intent==="steer"?"selected":""}>Steer Run 18</option><option value="followup" ${intent==="followup"?"selected":""}>Queue follow-up</option></select><select><option>GPT-5.3 Codex</option></select><select><option>Code</option><option>Plan</option></select><button class="send" ${disabled}>↑</button></div></div>`;
}
function render(){surface.innerHTML=controls();switcher.innerHTML=`<button data-cycle="-1">←</button>${Object.entries(variants).map(([key,name])=>`<button class="${key==variant?"active":""}" data-variant="${key}">${key} · ${name}</button>`).join("")}<button data-cycle="1">→</button><select data-state>${states.map(value=>`<option ${value==state?"selected":""}>${value}</option>`).join("")}</select>`;params.set("variant",variant);params.set("state",state);history.replaceState({},"",`?${params}`)}
function cycle(delta){const keys=Object.keys(variants);variant=keys[(keys.indexOf(variant)+delta+keys.length)%keys.length];render()}
document.addEventListener("click",event=>{const target=event.target.closest("button");if(!target)return;if(target.dataset.variant)variant=target.dataset.variant;if(target.dataset.cycle)cycle(Number(target.dataset.cycle));if(target.dataset.action==="intent")intent=intent==="steer"?"followup":"steer";if(target.dataset.action==="stop")state="quiet";render()});
document.addEventListener("change",event=>{if(event.target.matches("[data-state]"))state=event.target.value;if(event.target.matches('[data-action="intent"]'))intent=event.target.value;render()});
document.addEventListener("input",event=>{if(event.target.matches("[data-draft]")){draft=event.target.value;render();const composer=surface.querySelector("[data-draft]");composer.focus();composer.setSelectionRange(draft.length,draft.length)}});
document.addEventListener("keydown",event=>{if(["INPUT","TEXTAREA","SELECT"].includes(event.target.tagName))return;if(event.key==="ArrowLeft")cycle(-1);if(event.key==="ArrowRight")cycle(1)});
render();

/*
  Social media experiment — plain JavaScript, built for GitHub Pages.
  No external API, no login, no database, no participants' answers sent online.
  The research team gives each participant a code and a group-specific URL.
*/
'use strict';

const app = document.getElementById('app');
const toast = document.getElementById('toast');
const params = new URLSearchParams(window.location.search);
const groupFromLink = ['reaction', 'scroll'].includes(params.get('group')) ? params.get('group') : null;
const REACTIONS = [ ['Like','👍'], ['Congratulations!','👏'], ['Inspiring!','✨'], ['Love it!','❤️'] ];
const COLOURS = { RED:'#ed4554', BLUE:'#2675dc', GREEN:'#228b4e', YELLOW:'#bc8900' };
const STORE_KEY = 'socialMediaStudyCompletedV1';

let posts = [], exposure = [], oldPosts = [], newPosts = [], memoryItems = [];
let session = null;
let revealIndex = 0, actions = [], browsingSeconds = 0;
let browsingElapsed = 0, browseStarted = null, browsingActive = false, submittingFeed = false;
let stroopRemaining = 60, stroopDeadline = null, stroopInterval = null;
let currentInk = null, stroopAttempts = 0, stroopCorrect = 0, stroopFinishing = false;
let memoryIndex = 0, memoryAnswers = [], finished = false;
let finalResult = null, resultPng = '';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 5500);
}
function stage(name) {
  const names = ['setup','feed','stroop','memory','result'];
  const current = names.indexOf(name);
  document.querySelectorAll('.step').forEach((node, index) => {
    node.classList.toggle('active', index === current);
    node.classList.toggle('complete', index < current);
  });
}
function scrollTopNow() { window.scrollTo({top:0,behavior:'instant'}); }
function groupName(group) { return group === 'reaction' ? 'Reaction-based' : 'Infinite-scroll'; }
function getNumber(n) { return Math.round(n * 100) / 100; }

// The shuffled recognition order is identical for both groups and all participants.
function shuffleFixed(list, seed=2024) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    seed = (Math.imul(seed,1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [copy[i], copy[j]] = [copy[j],copy[i]];
  }
  return copy;
}
async function loadPosts() {
  if (posts.length) return;
  const response = await fetch('./data/posts.json', {cache:'no-store'});
  if (!response.ok) throw new Error('Could not load the post data. Check that you opened the site with HTTP or HTTPS.');
  const data = await response.json();
  if (!Array.isArray(data) || data.length !== 40 || new Set(data.map(p=>p.id)).size !== 40) {
    throw new Error('Expected 40 unique posts. Please check data/posts.json.');
  }
  posts = data;
  exposure = posts.filter(p => p.experiment_role === 'old' || p.experiment_role === 'exposure_only');
  oldPosts = posts.filter(p => p.experiment_role === 'old');
  newPosts = posts.filter(p => p.experiment_role === 'new');
  if (exposure.length !== 30 || oldPosts.length !== 20 || newPosts.length !== 10) {
    throw new Error('Post allocation must be 30 exposure, 20 old and 10 new.');
  }
  // This preserves relative URLs inside repositories like /social-media-study/ on GitHub Pages.
  memoryItems = shuffleFixed([...oldPosts, ...newPosts]);
}

function begin() {
  const field = document.getElementById('participant-code');
  const code = field.value.toUpperCase().replace(/\s/g,'').trim();
  const group = groupFromLink || document.querySelector('input[name="group"]:checked')?.value;
  if (!/^[A-Z][0-9]{3,4}$/.test(code)) {
    field.focus(); showToast('Enter your assigned code, such as A001 or B001.'); return;
  }
  if (!['reaction','scroll'].includes(group)) {showToast('Choose a study group.');return;}
  const button = document.getElementById('start-button');
  button.disabled = true;
  button.textContent = 'Loading posts…';
  loadPosts().then(() => {
    session = {code, group};
    revealIndex = 0; actions = []; memoryAnswers = []; memoryIndex = 0;
    browsingSeconds = 0; finished = false; finalResult = null; resultPng='';
    try {sessionStorage.removeItem(STORE_KEY);} catch(e) {/* Storage may be disabled */}
    renderFeed();
  }).catch(error => {showToast(error.message);button.disabled=false;button.textContent='Start the study →';});
}
function renderIntro() {
  stage('setup'); scrollTopNow();
  const hint = groupFromLink ? `<div class="locked-group">Assigned interface: ${groupName(groupFromLink)}</div>` : `
    <p class="intro-copy">The researcher chooses the group. Use a group-specific link when sending the study to participants.</p>
    <div class="option-grid">
      <label class="option"><input type="radio" name="group" value="reaction" checked><span class="option-body"><strong>♡ Reaction-based</strong><small>React to each post, or select Not Interested, to move forward.</small></span></label>
      <label class="option"><input type="radio" name="group" value="scroll"><span class="option-body"><strong>↕ Infinite-scroll</strong><small>Move freely through the same feed without reacting.</small></span></label>
    </div>`;
  app.innerHTML = `<section class="panel">
    <div class="eyebrow">Study setup</div><h1>Social media experiment</h1>
    <p class="intro-copy">Please use the participant code given by the researcher. The experiment includes browsing social media posts, a short colour task and a memory test.</p>
    ${hint}
    <label class="field-label" for="participant-code">Participant ID</label>
    <input id="participant-code" class="code-input" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" maxlength="5" placeholder="A001" value="${escapeHtml((params.get('id') || '').slice(0,5).toUpperCase())}">
    <p class="help">Use only your assigned study code. Do not enter your name or email address.</p>
    <div class="action-row"><button class="primary" id="start-button">Start the study →</button></div>
    <p class="help">Only start after the researcher has completed the approved information and consent process.</p>
  </section>`;
  document.getElementById('start-button').addEventListener('click', begin);
  document.getElementById('participant-code').addEventListener('keydown', e => {if(e.key==='Enter')begin();});
}

function postCard(p, index, mode) {
  const image = escapeHtml(p.image.replace(/^\/+/,''));
  let hash = 0;
  for (const char of p.id + p.title) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  const likes = 25 + (hash % 380);
  const controls = mode === 'reaction' ? `<div class="reaction-bar"><button type="button" class="react-btn" data-action="menu" aria-expanded="false">♡ React</button><button type="button" class="skip-btn" data-action="skip">Not Interested →</button></div>
    <div class="react-options" hidden>${REACTIONS.map(([reaction,emoji]) => `<button type="button" data-reaction="${escapeHtml(reaction)}">${emoji} ${escapeHtml(reaction)}</button>`).join('')}</div>`
    : mode === 'scroll' ? `<div class="passive-actions" aria-hidden="true"><span>♡</span><span>▤</span><span>↗</span></div>` : '';
  return `<article class="note" id="post-${index}" data-index="${index}">
     <img class="photo" src="${image}" alt="${escapeHtml(p.title)}" loading="${mode === 'memory' ? 'eager' : 'lazy'}" decoding="async">
     <div class="note-body"><span class="topic">${escapeHtml(p.category)}</span><h3>${escapeHtml(p.title)}</h3><p class="post-text">${escapeHtml(p.text)}</p>
       <div class="meta"><span class="avatar">${escapeHtml(p.author[0].toUpperCase())}</span><span class="author">${escapeHtml(p.author)}</span><span class="likes">♡ ${likes}</span></div>
     </div>${controls}</article>`;
}
function startBrowsingClock() {
  browsingElapsed = 0; browseStarted = document.hidden ? null : performance.now(); browsingActive=true;
}
function elapsedBrowsing() {
  return browsingElapsed + (browseStarted === null ? 0 : performance.now()-browseStarted);
}
function stopBrowsingClock() {
  browsingSeconds = getNumber(elapsedBrowsing()/1000);
  browseStarted = null; browsingActive=false;
}
function renderFeed() {
  stage('feed'); scrollTopNow();
  const isReaction = session.group === 'reaction';
  app.innerHTML = `<div class="note-grid" id="note-grid"></div>
  <div class="end-feed" id="end-feed" ${isReaction ? 'hidden' : ''}><h2>End of the feed</h2>
    <p>Continue when you are ready for the next task.</p>
    <button type="button" class="primary" id="continue-feed" disabled>Continue to colour task →</button></div>`;
  const grid = document.getElementById('note-grid');
  if (isReaction) {
    revealIndex = 0;
    revealNext();
  } else {
    grid.innerHTML = exposure.map((post,i) => postCard(post,i,'scroll')).join('');
    const end = document.getElementById('end-feed');
    const continueButton = document.getElementById('continue-feed');
    const observer = new IntersectionObserver(entries => {
      if (entries.some(x => x.isIntersecting)) {continueButton.disabled = false;observer.disconnect();}
    },{threshold:0.2});
    observer.observe(end);
    continueButton.addEventListener('click', finishFeed);
  }
  startBrowsingClock();
}
function revealNext() {
  if (revealIndex >= exposure.length) return;
  const i = revealIndex++;
  document.getElementById('note-grid').insertAdjacentHTML('beforeend',postCard(exposure[i],i,'reaction'));
  const card = document.getElementById('post-' + i);
  const menu = card.querySelector('.react-options');
  const toggle = card.querySelector('[data-action="menu"]');
  toggle.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    toggle.setAttribute('aria-expanded',String(!menu.hidden));
  });
  card.querySelector('[data-action="skip"]').addEventListener('click',() => react(i, 'Not Interested'));
  card.querySelectorAll('[data-reaction]').forEach(button => {
    button.addEventListener('click',() => react(i,button.dataset.reaction));
  });
  if (i > 0) setTimeout(() => card.scrollIntoView({behavior:'smooth',block:'start'}),80);
}
function react(i, reaction) {
  if (submittingFeed || i !== actions.length) return;
  actions.push({post_id:exposure[i].id,reaction,at_second:getNumber(elapsedBrowsing()/1000)});
  const card = document.getElementById('post-' + i);
  card.querySelectorAll('button').forEach(b => b.disabled=true);
  card.querySelector('.react-options').hidden = true;
  card.querySelector('.reaction-bar').outerHTML = `<div class="react-complete">✓ ${escapeHtml(reaction)} · Saved</div>`;
  if (actions.length === exposure.length) finishFeed();
  else revealNext();
}
function finishFeed() {
  if (submittingFeed) return;
  submittingFeed = true;
  stopBrowsingClock();
  renderStroopIntro();
}

function renderStroopIntro() {
  stage('stroop');scrollTopNow();
  app.innerHTML = `<section class="stage"><div class="eyebrow">Colour task</div>
    <h1>A short colour challenge</h1><p class="subline">You will see a colour word printed in a different colour. Tap the <strong>colour of the letters</strong>, not the word itself. This task lasts 60 seconds.</p>
    <div class="sample-word"><span class="word">RED</span><span class="explanation">Correct answer: BLUE</span></div>
    <button class="primary" id="start-stroop">Start 60-second colour task →</button></section>`;
  document.getElementById('start-stroop').addEventListener('click',startStroop);
}
function startStroop() {
  stroopRemaining = 60; stroopAttempts = 0; stroopCorrect=0;stroopFinishing=false;
  app.innerHTML = `<section class="stage"><div class="eyebrow">Colour task</div><h1>What colour are the letters?</h1>
    <p class="subline">Ignore the meaning of the word. Select its ink colour.</p>
    <div class="stroop-main"><div class="timer-box">Time left: <span id="stroop-timer">60</span> s</div><div class="stroop-word" id="stroop-word">RED</div>
      <div class="colour-keys">${Object.keys(COLOURS).map(name => `<button type="button" data-colour="${name}">${name}</button>`).join('')}</div>
    </div></section>`;
  document.querySelectorAll('[data-colour]').forEach(button => {
    button.addEventListener('click',() => {
      if (stroopFinishing || stroopDeadline === null) return;
      stroopAttempts++;
      if (button.dataset.colour === currentInk) stroopCorrect++;
      nextStroopWord();
    });
  });
  nextStroopWord();
  runStroopTimer();
}
function nextStroopWord() {
  const keys = Object.keys(COLOURS);
  const word = keys[Math.floor(Math.random() * keys.length)];
  let ink = keys[Math.floor(Math.random() * keys.length)];
  while (word === ink) ink = keys[Math.floor(Math.random() * keys.length)];
  currentInk = ink;
  const el = document.getElementById('stroop-word');
  if(el) {el.textContent=word;el.style.color=COLOURS[ink];}
}
function runStroopTimer() {
  clearInterval(stroopInterval);
  stroopDeadline = performance.now() + stroopRemaining * 1000;
  stroopInterval = setInterval(() => {
    const remaining = Math.max(0,Math.ceil((stroopDeadline - performance.now())/1000));
    const timer = document.getElementById('stroop-timer');
    if(timer) timer.textContent=remaining;
    stroopRemaining=remaining;
    if (remaining <= 0) finishStroop();
  },100);
}
function finishStroop() {
  if (stroopFinishing) return;
  stroopFinishing=true;
  clearInterval(stroopInterval);
  stroopInterval=null;stroopDeadline=null;
  document.querySelectorAll('[data-colour]').forEach(button => button.disabled=true);
  memoryIndex=0;memoryAnswers=[];
  renderMemory();
}
document.addEventListener('visibilitychange',() => {
  if(browsingActive) {
    if(document.hidden && browseStarted !== null) {browsingElapsed += performance.now() - browseStarted;browseStarted=null;}
    else if(!document.hidden && browseStarted === null) browseStarted=performance.now();
  }
  if(!stroopFinishing && stroopDeadline !== null && document.hidden) {
    stroopRemaining=Math.max(0,(stroopDeadline-performance.now())/1000);
    clearInterval(stroopInterval);stroopInterval=null;stroopDeadline=null;
  } else if(!document.hidden && !stroopFinishing && stroopDeadline === null && stroopInterval === null && document.getElementById('stroop-timer')) {
    if(stroopRemaining<=0) finishStroop(); else runStroopTimer();
  }
});

function renderMemory() {stage('memory');scrollTopNow();showQuestion();}
function showQuestion() {
  if (memoryIndex >= memoryItems.length) { finishMemory();return; }
  const post=memoryItems[memoryIndex];
  app.innerHTML=`<section class="stage"><div class="eyebrow">Recognition test</div><h1>Have you seen this post before?</h1>
    <p class="subline">Tap <strong>Old</strong> if this post appeared earlier, or <strong>New</strong> if you did not see it.</p>
    <div class="question-count">Question ${memoryIndex+1} of ${memoryItems.length}</div>
    <div class="progress-line"><div style="width:${(memoryIndex+1)*100/memoryItems.length}%"></div></div>
    <div class="test-post">${postCard(post,memoryIndex,'memory')}</div>
    <div class="choice-row"><button type="button" id="old-button">Old</button><button type="button" id="new-button">New</button></div>
  </section>`;
  document.getElementById('old-button').addEventListener('click',()=>answer('old'));
  document.getElementById('new-button').addEventListener('click',()=>answer('new'));
  scrollTopNow();
}
function answer(value) {
  if(finished) return;
  const p=memoryItems[memoryIndex];
  memoryAnswers.push({post_id:p.id,answer:value});
  memoryIndex++;
  showQuestion();
}

// Inverse standard normal CDF approximation (Peter J. Acklam); avoids dependencies.
function inverseNormal(p) {
  if(!(p>0 && p<1)) throw new Error('Probability must be between 0 and 1.');
  const a=[-39.69683028665376,220.9460984245205,-275.9285104469687,138.357751867269,-30.66479806614716,2.506628277459239];
  const b=[-54.47609879822406,161.5858368580409,-155.6989798598866,66.80131188771972,-13.28068155288572];
  const c=[-0.007784894002430293,-0.3223964580411365,-2.400758277161838,-2.549732539343734,4.374664141464968,2.938163982698783];
  const d=[0.007784695709041462,0.3224671290700398,2.445134137142996,3.754408661907416];
  const plow=0.02425;
  if(p<plow){const q=Math.sqrt(-2*Math.log(p));return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}
  if(p>1-plow){const q=Math.sqrt(-2*Math.log(1-p));return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}
  const q=p-0.5, r=q*q;
  return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
}
function finishMemory() {
  if(finished) return;
  finished=true;
  const isOld=new Set(oldPosts.map(p=>p.id));
  const isNew=new Set(newPosts.map(p=>p.id));
  const hits=memoryAnswers.filter(a=>isOld.has(a.post_id) && a.answer==='old').length;
  const falseAlarms=memoryAnswers.filter(a=>isNew.has(a.post_id) && a.answer==='old').length;
  const correct=hits+(newPosts.length-falseAlarms);
  const h=(hits+0.5)/21, f=(falseAlarms+0.5)/11;
  finalResult={code:session.code,group:session.group,browsing_seconds:browsingSeconds,
    memory_correct:correct,memory_incorrect:memoryItems.length-correct,hits,false_alarms:falseAlarms,
    d_prime:getNumber(inverseNormal(h)-inverseNormal(f)),completed_at:new Date().toISOString()};
  try {sessionStorage.setItem(STORE_KEY,JSON.stringify(finalResult));} catch(e) {/* Storage may be disabled */}
  renderResult();
}
function formatDuration(s) {
  const secs=Math.round(s);
  return `${String(Math.floor(secs/60)).padStart(2,'0')}:${String(secs%60).padStart(2,'0')}`;
}
function renderResult() {
  if(!finalResult) return renderIntro();
  stage('result');scrollTopNow();
  const r=finalResult;
  app.innerHTML=`<section class="stage" id="result-page">
    <div class="eyebrow">Study complete</div><h1>Your memory test result</h1>
    <p class="participant-line">Participant ID: <strong>${escapeHtml(r.code)}</strong> · ${groupName(r.group)}</p>
    <div class="result-grid">
      <div class="result-tile"><strong>${r.memory_correct}</strong><span>Correct / 30</span></div>
      <div class="result-tile"><strong>${r.memory_incorrect}</strong><span>Incorrect / 30</span></div>
    </div>
    <div class="result-details">
      <div class="result-detail-row"><span class="result-detail-label">Hits (old posts correctly recognised)</span><strong class="result-detail-value">${r.hits} / 20</strong></div>
      <div class="result-detail-row"><span class="result-detail-label">False alarms (new posts marked Old)</span><strong class="result-detail-value">${r.false_alarms} / 10</strong></div>
      <div class="result-detail-row"><span class="result-detail-label">Browsing time</span><strong class="result-detail-value">${formatDuration(r.browsing_seconds)}</strong></div>
    </div>
    <button type="button" class="primary save-btn" id="save-image">Save Result as Image (PNG)</button>
    <div class="preview-box" id="preview-box" hidden>
      <p><strong>Result image ready.</strong> If your phone did not download the PNG, press and hold the image below to save it to Photos. You can also take a screenshot.</p>
      <a class="preview-link" id="image-link" download="social-media-result.png">Download PNG again</a>
      <img id="result-preview" alt="Image of your research results">
    </div>
    <div class="action-row"><button type="button" class="secondary" id="new-session">Start another session</button></div>
  </section>`;
  document.getElementById('save-image').addEventListener('click',saveImage);
  document.getElementById('new-session').addEventListener('click',() => {
    if(!confirm('Start a new session? Make sure you have saved your result image first.')) return;
    try {sessionStorage.removeItem(STORE_KEY);} catch(e) {/* Storage may be disabled */}
    finalResult=null; session=null;finished=false;submittingFeed=false;
    renderIntro();
  });
}

// Draw the score card with the built-in Canvas API; no CDN or external package.
function createResultPng(r) {
  const canvas=document.createElement('canvas'); canvas.width=1000;canvas.height=1040;
  const c=canvas.getContext('2d');
  c.fillStyle='#fff';c.fillRect(0,0,1000,1040);
  c.fillStyle='#f02b4b';c.fillRect(0,0,1000,26);
  c.fillStyle='#222';c.font='bold 31px Arial, sans-serif';c.fillText('SOCIAL MEDIA EXPERIMENT',72,113);
  c.font='bold 49px Arial, sans-serif';c.fillText('Memory test result',72,196);
  c.fillStyle='#454545';c.font='26px Arial, sans-serif';c.fillText(`Participant ID: ${r.code}`,72,260);
  c.fillText(`Group: ${groupName(r.group)}`,72,305);
  c.fillStyle='#f6f6f7';c.fillRect(72,356,413,244);c.fillRect(515,356,413,244);
  c.fillStyle='#222';c.font='bold 114px Arial, sans-serif';
  c.textAlign='center';c.fillText(String(r.memory_correct),279,491);c.fillText(String(r.memory_incorrect),722,491);
  c.font='bold 26px Arial, sans-serif';c.fillText('Correct / 30',279,555);c.fillText('Incorrect / 30',722,555);c.textAlign='left';
  c.fillStyle='#eeeeef';c.fillRect(72,662,856,2);
  const rows=[['Hits (old posts)',`${r.hits} / 20`],['False alarms (new posts)',`${r.false_alarms} / 10`],['Browsing time',formatDuration(r.browsing_seconds)]];
  rows.forEach(([key,value],i)=>{
    const y=721+i*93;
    c.fillStyle='#3c3c3c';c.font='26px Arial, sans-serif';c.fillText(key,74,y);
    c.fillStyle='#222';c.textAlign='right';c.font='bold 31px Arial, sans-serif';c.fillText(value,925,y);c.textAlign='left';
    if(i<rows.length-1){c.fillStyle='#efeff0';c.fillRect(72,y+33,856,2);}
  });

  return canvas.toDataURL('image/png');
}
function saveImage() {
  if(!finalResult) return;
  try {
    resultPng=createResultPng(finalResult);
    const filename=`social-media-result-${finalResult.code}.png`;
    const a=document.createElement('a');a.href=resultPng;a.download=filename;
    document.body.appendChild(a);a.click();a.remove();
    const box=document.getElementById('preview-box');
    box.hidden=false;
    const preview=document.getElementById('result-preview'); preview.src=resultPng;
    const link=document.getElementById('image-link');link.href=resultPng;link.download=filename;
    box.scrollIntoView({behavior:'smooth',block:'nearest'});
  } catch (err) {showToast('Could not generate the image. You can take a screenshot of the results.');}
}

// Refreshing after completion can recover the last result in this browser tab.
try {
  const saved=sessionStorage.getItem(STORE_KEY);
  if(saved) {
    const parsed=JSON.parse(saved);
    if(parsed?.code && ['reaction','scroll'].includes(parsed.group) && (!groupFromLink || parsed.group===groupFromLink)) finalResult=parsed;
  }
} catch(e) {/* The site still works if storage is blocked. */}
if(finalResult) renderResult(); else renderIntro();

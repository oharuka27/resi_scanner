const COLORS = {
  black: {ja:'黒', hex:'#171717', digit:0, multiplier:1},
  brown: {ja:'茶', hex:'#784222', digit:1, multiplier:10, tolerance:1},
  red: {ja:'赤', hex:'#c42d2d', digit:2, multiplier:100, tolerance:2},
  orange: {ja:'橙', hex:'#e98523', digit:3, multiplier:1000},
  yellow: {ja:'黄', hex:'#e6cb30', digit:4, multiplier:10000},
  green: {ja:'緑', hex:'#31934c', digit:5, multiplier:100000, tolerance:0.5},
  blue: {ja:'青', hex:'#3270ba', digit:6, multiplier:1000000, tolerance:0.25},
  violet: {ja:'紫', hex:'#8744aa', digit:7, multiplier:10000000, tolerance:0.1},
  gray: {ja:'灰', hex:'#888888', digit:8, multiplier:100000000, tolerance:0.05},
  white: {ja:'白', hex:'#eeeeee', digit:9, multiplier:1000000000},
  gold: {ja:'金', hex:'#b69a52', multiplier:0.1, tolerance:5},
  silver: {ja:'銀', hex:'#b8bec2', multiplier:0.01, tolerance:10}
};
const canvas = document.querySelector('#canvas');
const ctx = canvas.getContext('2d', {willReadFrequently:true});
const video = document.querySelector('#video');
const imageInput = document.querySelector('#imageInput');
const bandsElement = document.querySelector('#bands');
const resultElement = document.querySelector('#result');
const statusElement = document.querySelector('#status');
const emptyState = document.querySelector('#emptyState');
const magnifier = document.querySelector('#magnifier');
const zoomCtx = document.querySelector('#zoomCanvas').getContext('2d');
let bandCount = 4;
let picks = [];
let sourceImage = null;
let stream = null;

function hexRgb(hex){return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));}
function rgbLab([r,g,b]){
  const linear = [r,g,b].map(v => {v/=255;return v>0.04045?((v+0.055)/1.055)**2.4:v/12.92;});
  const [x,y,z]=[(linear[0]*.4124+linear[1]*.3576+linear[2]*.1805)/.95047,(linear[0]*.2126+linear[1]*.7152+linear[2]*.0722),(linear[0]*.0193+linear[1]*.1192+linear[2]*.9505)/1.08883].map(v=>v>0.008856?Math.cbrt(v):7.787*v+16/116);
  return [116*y-16,500*(x-y),200*(y-z)];
}
const palette = Object.entries(COLORS).map(([key,value])=>({key,lab:rgbLab(hexRgb(value.hex))}));
function classify(rgb){
  const lab=rgbLab(rgb);
  return palette.reduce((best,item)=>{
    const distance=item.lab.reduce((sum,v,i)=>sum+(v-lab[i])**2,0);
    return distance<best.distance?{key:item.key,distance}:best;
  },{key:'black',distance:Infinity}).key;
}
function sampleColor(x,y){
  const radius=Math.max(2,Math.round(Math.min(canvas.width,canvas.height)*0.006));
  const pixels=ctx.getImageData(Math.max(0,x-radius),Math.max(0,y-radius),Math.min(canvas.width,x+radius+1)-Math.max(0,x-radius),Math.min(canvas.height,y+radius+1)-Math.max(0,y-radius)).data;
  const channels=[[],[],[]];
  for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]>200)for(let c=0;c<3;c++)channels[c].push(pixels[i+c]);}
  return channels.map(values=>{values.sort((a,b)=>a-b);return values[Math.floor(values.length/2)]??0;});
}
function formatOhms(value){
  const units=[[1e9,'GΩ'],[1e6,'MΩ'],[1e3,'kΩ'],[1,'Ω']];
  const [scale,unit]=units.find(([n])=>value>=n)||units[3];
  return `${Number((value/scale).toPrecision(4))} ${unit}`;
}
function updateResult(){
  bandsElement.replaceChildren();
  picks.forEach((pick,i)=>{
    const row=document.createElement('div');row.className='band-row';
    const swatch=document.createElement('span');swatch.className='swatch';swatch.style.background=COLORS[pick.color].hex;
    const label=document.createElement('label');label.textContent=`${i+1} 本目`;
    const select=document.createElement('select');select.setAttribute('aria-label',`${i+1}本目の色`);
    const allowed=i===bandCount-1?Object.keys(COLORS).filter(k=>COLORS[k].tolerance!==undefined):i===bandCount-2?Object.keys(COLORS):Object.keys(COLORS).filter(k=>COLORS[k].digit!==undefined);
    for(const key of allowed){const option=document.createElement('option');option.value=key;option.textContent=COLORS[key].ja;select.append(option);}
    if(!allowed.includes(pick.color))pick.color=allowed[0];
    select.value=pick.color;
    select.addEventListener('change',()=>{pick.color=select.value;updateResult();});
    row.append(swatch,label,select);bandsElement.append(row);
  });
  document.querySelector('#undoButton').disabled=!picks.length;
  document.querySelector('#clearButton').disabled=!picks.length;
  if(picks.length<bandCount){resultElement.textContent=picks.length?`あと ${bandCount-picks.length} 本選んでください。`:'帯を選ぶと、ここに抵抗値を表示します。';statusElement.textContent='';return;}
  const digits=picks.slice(0,bandCount-2).map(p=>COLORS[p.color].digit);
  const multiplier=COLORS[picks[bandCount-2].color].multiplier;
  const tolerance=COLORS[picks[bandCount-1].color].tolerance;
  const value=Number(digits.join(''))*multiplier;
  resultElement.innerHTML=`<strong>${formatOhms(value)}</strong> ±${tolerance}%`;
  statusElement.textContent=`色: ${picks.map(p=>COLORS[p.color].ja).join(' → ')}。色が違う場合は各帯の選択欄で修正してください。`;
}
function redraw(){
  if(!sourceImage)return;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(sourceImage,0,0,canvas.width,canvas.height);
  picks.forEach((p,i)=>{
    ctx.beginPath();ctx.arc(p.x,p.y,Math.max(9,canvas.width*.012),0,Math.PI*2);
    ctx.fillStyle=COLORS[p.color].hex;ctx.fill();ctx.lineWidth=Math.max(2,canvas.width*.003);ctx.strokeStyle='#fff';ctx.stroke();
    ctx.font=`bold ${Math.max(15,canvas.width*.025)}px sans-serif`;ctx.fillStyle='#fff';ctx.fillText(String(i+1),p.x+13,p.y-12);
  });
}
function setImage(image){
  sourceImage=image;
  const scale=Math.min(1,1600/Math.max(image.width,image.height));
  canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
  canvas.hidden=false;emptyState.hidden=true;picks=[];redraw();updateResult();
}
imageInput.addEventListener('change',async()=>{
  const file=imageInput.files?.[0];if(!file)return;
  const url=URL.createObjectURL(file);
  try{const image=new Image();image.src=url;await image.decode();setImage(image);stopCamera();}
  catch{document.querySelector('#cameraMessage').textContent='画像を読み込めませんでした。別の画像を選んでください。';}
  finally{URL.revokeObjectURL(url);imageInput.value='';}
});
canvas.addEventListener('click',event=>{
  if(!sourceImage||picks.length>=bandCount)return;
  const rect=canvas.getBoundingClientRect();
  const x=Math.min(canvas.width-1,Math.max(0,Math.floor((event.clientX-rect.left)*canvas.width/rect.width)));
  const y=Math.min(canvas.height-1,Math.max(0,Math.floor((event.clientY-rect.top)*canvas.height/rect.height)));
  ctx.drawImage(sourceImage,0,0,canvas.width,canvas.height);
  const rgb=sampleColor(x,y);picks.push({x,y,color:classify(rgb)});redraw();updateResult();
  const half=12;zoomCtx.imageSmoothingEnabled=false;zoomCtx.clearRect(0,0,120,120);zoomCtx.drawImage(canvas,Math.max(0,x-half),Math.max(0,y-half),half*2,half*2,0,0,120,120);magnifier.hidden=false;
});
document.querySelector('#undoButton').addEventListener('click',()=>{picks.pop();redraw();updateResult();});
document.querySelector('#clearButton').addEventListener('click',()=>{picks=[];redraw();updateResult();magnifier.hidden=true;});
document.querySelectorAll('[data-band-count]').forEach(button=>button.addEventListener('click',()=>{
  bandCount=Number(button.dataset.bandCount);picks=[];redraw();updateResult();
  document.querySelectorAll('[data-band-count]').forEach(b=>{const selected=b===button;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',selected);});
}));
async function stopCamera(){if(stream){stream.getTracks().forEach(track=>track.stop());stream=null;}video.srcObject=null;video.hidden=true;document.querySelector('#captureButton').hidden=true;document.querySelector('#stopButton').hidden=true;document.querySelector('#cameraButton').hidden=false;}
document.querySelector('#cameraButton').addEventListener('click',async()=>{
  const message=document.querySelector('#cameraMessage');
  if(!navigator.mediaDevices?.getUserMedia){message.textContent='このブラウザではカメラを使えません。画像選択をお試しください。';return;}
  try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});video.srcObject=stream;video.hidden=false;canvas.hidden=true;emptyState.hidden=true;document.querySelector('#captureButton').hidden=false;document.querySelector('#stopButton').hidden=false;document.querySelector('#cameraButton').hidden=true;message.textContent='抵抗を画面に入れて「この画像を撮影」を押してください。';}
  catch(error){message.textContent=`カメラを開けませんでした（${error.name}）。画像選択をお試しください。`;}
});
document.querySelector('#captureButton').addEventListener('click',()=>{
  if(!video.videoWidth)return;
  const capture=document.createElement('canvas');capture.width=video.videoWidth;capture.height=video.videoHeight;capture.getContext('2d').drawImage(video,0,0);
  setImage(capture);stopCamera();document.querySelector('#cameraMessage').textContent='撮影しました。帯を左から順にタップしてください。';
});
document.querySelector('#stopButton').addEventListener('click',()=>{stopCamera();canvas.hidden=!sourceImage;emptyState.hidden=!!sourceImage;});
updateResult();

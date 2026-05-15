let stream=null, recorder=null, chunks=[];
let interval=null, paused=false, speed=1.8;

const preview=document.getElementById('preview');
const uploaded=document.getElementById('uploaded');
const prompter=document.getElementById('prompter');
const textEl=document.getElementById('prompter-text');
const speedSlider=document.getElementById('speed');
const sizeSlider=document.getElementById('size');

async function startCamera(){
  try{
    if(stream)stream.getTracks().forEach(t=>t.stop());
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user"},audio:true});
    preview.srcObject=stream;
    preview.style.display="block";
    uploaded.style.display="none";
    return true;
  }catch(e){alert("Autorise caméra + micro");return false;}
}

function switchMode(mode){
  document.querySelectorAll(".tab").forEach(t=>t.classList.remove("active"));
  if(mode==="live"){
    document.getElementById("live-tab").classList.add("active");
    startCamera();
  }else{
    document.getElementById("import-tab").classList.add("active");
  }
}

function loadVideo(input){
  const f=input.files[0];
  if(!f)return;
  uploaded.src=URL.createObjectURL(f);
  uploaded.style.display="block";
  preview.style.display="none";
  uploaded.play();
}

function startPrompter(){
  const txt=document.getElementById("script")?document.getElementById("script").value.trim():"";
  if(!txt)return alert("Écris le texte !");
  textEl.textContent=txt;
  prompter.style.display="flex";
  let pos=0;
  clearInterval(interval);
  interval=setInterval(()=>{
    if(paused)return;
    pos+=3.5*speed;
    textEl.style.transform=`translateY(-${pos}px)`;
  },16);
}

function togglePause(){paused=!paused;}
function resetPrompter(){
  clearInterval(interval);
  prompter.style.display="none";
  textEl.style.transform="none";
}

function toggleRecording(){
  const btn=document.querySelector(".btn.rec");
  if(!recorder||recorder.state==="inactive"){
    if(!stream)startCamera();
    recorder=new MediaRecorder(stream);
    chunks=[];
    recorder.ondataavailable=e=>chunks.push(e.data);
    recorder.onstop=()=>{
      const blob=new Blob(chunks,{type:"video/webm"});
      const a=document.createElement("a");
      a.href=URL.createObjectURL(blob);
      a.download=`teleprompter-${Date.now()}.webm`;
      a.click();
    };
    recorder.start();
    btn.textContent="⏹ Stop Rec";
    btn.style.background="#0f0";
  }else{
    recorder.stop();
    btn.textContent="● Rec";
    btn.style.background="#f00";
  }
}

function downloadVideo(){
  const vid=uploaded.style.display==="block"?uploaded:preview;
  if(vid.srcObject||vid.src){
    const a=document.createElement("a");
    a.href=vid.src||URL.createObjectURL(new Blob());
    a.download="video.mp4";
    a.click();
  }
}

window.onload=()=>{
  switchMode("live");
  speedSlider.oninput=()=>speed=+speedSlider.value;
  sizeSlider.oninput=()=>textEl.style.fontSize=sizeSlider.value+"px";
};

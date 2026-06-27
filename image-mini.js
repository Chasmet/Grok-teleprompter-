window.addEventListener('DOMContentLoaded',()=>{
  const panel=document.getElementById('facecamPanel');
  const mode=document.getElementById('modeFacecamBtn');
  const file=document.getElementById('videoInput');
  const vid=document.getElementById('importedVideo');
  const cam=document.getElementById('cameraPreview');
  const wrap=document.querySelector('.preview-container');
  if(!panel||!mode||!file||!vid||!cam||!wrap)return;

  file.accept='video/*,image/*';

  const imgInput=document.createElement('input');
  imgInput.type='file';
  imgInput.accept='image/*';
  imgInput.id='imageInput';
  imgInput.style.display='none';
  panel.appendChild(imgInput);

  const imgBtn=document.createElement('label');
  imgBtn.htmlFor='imageInput';
  imgBtn.className='file-btn btn-sub';
  imgBtn.textContent='Image';
  panel.insertBefore(imgBtn,panel.children[1]||null);

  const mini=document.createElement('button');
  mini.type='button';
  mini.className='btn-sub';
  mini.textContent='Mini facecam';
  panel.appendChild(mini);

  const img=new Image();
  img.style.cssText='display:none;position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;z-index:1';
  wrap.appendChild(img);

  const cv=document.createElement('canvas');
  const cx=cv.getContext('2d');
  let isImg=false,url='',raf=0;

  function active(){return mode.classList.contains('active')}
  function fit(src,x,y,w,h){
    const sw0=src.videoWidth||src.naturalWidth||w,sh0=src.videoHeight||src.naturalHeight||h;
    const sc=Math.min(w/sw0,h/sh0),dw=sw0*sc,dh=sh0*sc;
    cx.drawImage(src,x+(w-dw)/2,y+(h-dh)/2,dw,dh);
  }
  function size(){cv.width=isImg?(img.naturalWidth||720):(vid.videoWidth||720);cv.height=isImg?(img.naturalHeight||1280):(vid.videoHeight||1280)}
  function draw(){
    size();const w=cv.width,h=cv.height;cx.fillStyle='#000';cx.fillRect(0,0,w,h);
    if(isImg&&img.complete)fit(img,0,0,w,h);else if(vid.readyState>=2)fit(vid,0,0,w,h);
    if(cam.readyState>=2){const a=wrap.getBoundingClientRect(),b=cam.getBoundingClientRect();const x=((b.left-a.left)/a.width)*w,y=((b.top-a.top)/a.height)*h,cw=(b.width/a.width)*w,ch=(b.height/a.height)*h;fit(cam,x,y,cw,ch);cx.lineWidth=Math.max(4,w*.006);cx.strokeStyle='#fff';cx.strokeRect(x,y,cw,ch)}
    raf=requestAnimationFrame(draw);
  }
  function start(){if(raf)cancelAnimationFrame(raf);size();draw()}
  function stream(){if(!active()&&vid.__realCap)return vid.__realCap();start();return cv.captureStream(30)}
  if(!vid.__realCap)vid.__realCap=vid.captureStream?vid.captureStream.bind(vid):null;
  vid.captureStream=stream;
  vid.mozCaptureStream=stream;

  function loadImage(f){isImg=true;if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(f);img.src=url;img.style.display='block';vid.src=url;vid.style.display='none';if(window.setStatus)setStatus('Image prete','success')}
  imgInput.addEventListener('change',e=>{const f=e.target.files[0];if(f)loadImage(f)});
  file.addEventListener('change',e=>{const f=e.target.files[0];if(!f)return;if(f.type.startsWith('image/'))loadImage(f);else{isImg=false;img.style.display='none'}});
  mini.addEventListener('click',()=>{const s=document.getElementById('facecamSmallBtn');if(s){s.click();s.click();s.click()}setTimeout(()=>{cam.style.width='18%';cam.style.height='16%'},80)});
  document.getElementById('recordBtn').addEventListener('click',()=>{if(active())start()},true);
  document.getElementById('stopBtn').addEventListener('click',()=>setTimeout(()=>{if(raf)cancelAnimationFrame(raf);raf=0},1400),true);
});

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, query, where, orderBy, runTransaction, doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, ADMIN_EMAILS, GROUND_ID } from "./firebase-config.js";

const $=id=>document.getElementById(id);
const WA="919979692444", DAY_RATE=500, NIGHT_RATE=1200;
const configured=!!firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("PASTE_") && !!firebaseConfig.projectId && !firebaseConfig.projectId.startsWith("PASTE_");
let db=null,auth=null,user=null,selected=null,quoteData=null,allAdminBookings=[];
const localToday=()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)};
$("startDate").value=localToday();$("endDate").value=localToday();$("adminDate").value=localToday();$("startDate").min=localToday();$("endDate").min=localToday();

function notify(msg){$("notice").textContent=msg;$("notice").classList.remove("hidden");setTimeout(()=>$("notice").classList.add("hidden"),5000)}
function toStamp(date,time){return new Date(`${date}T${time}:00`).getTime()}
function fmtTime(date){return new Date(date).toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"})}
function splitPrice(startMs,endMs){
 let total=0,parts=[],cursor=startMs;
 while(cursor<endMs){
  const d=new Date(cursor), y=d.getFullYear(),m=d.getMonth(),day=d.getDate();
  const dayStart=new Date(y,m,day,6,0,0).getTime();
  const dayEnd=new Date(y,m,day,18,0,0).getTime();
  let boundary,rate,label;
  if(cursor<dayStart){boundary=dayStart;rate=NIGHT_RATE;label="Night"}
  else if(cursor<dayEnd){boundary=dayEnd;rate=DAY_RATE;label="Day"}
  else {boundary=new Date(y,m,day+1,6,0,0).getTime();rate=NIGHT_RATE;label="Night"}
  const segmentEnd=Math.min(boundary,endMs),hours=(segmentEnd-cursor)/3600000,amount=hours*rate;
  total+=amount;parts.push({label,hours,rate,amount,start:cursor,end:segmentEnd});cursor=segmentEnd;
 }
 return {total,parts};
}
function makeQuote(startDate,startTime,endDate,endTime){
 const start=toStamp(startDate,startTime),end=toStamp(endDate,endTime);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw Error("End time must be after start time.");
 if(start<Date.now()-60000)throw Error("Please choose a future booking time.");
 const hours=(end-start)/3600000;if(hours>24)throw Error("A single booking can be up to 24 hours. Please split longer bookings.");
 const p=splitPrice(start,end);
 return {start,end,hours,total:p.total,parts:p.parts,startDate,startTime,endDate,endTime};
}
function showQuote(q){
 quoteData=q;selected=null;
 const lines=q.parts.map(p=>`${p.label}: ${p.hours} hr × ₹${p.rate} = ₹${p.amount.toLocaleString("en-IN")}`).join("<br>");
 $("quote").innerHTML=`<span class="eyebrow">PRICE ESTIMATE</span><strong>₹${q.total.toLocaleString("en-IN")}</strong><div class="breakdown">${lines}<br>Total duration: ${q.hours} hour(s)</div>`;
 $("quote").classList.remove("hidden");$("customerDetails").classList.remove("hidden");
}
function clearQuote(){quoteData=null;$("quote").classList.add("hidden");$("customerDetails").classList.add("hidden")}
async function fetchDayBookings(date){
 if(!db)return [];
 const q=query(collection(db,"occupiedSlots"),where("groundId","==",GROUND_ID),where("startDate","<=",date),orderBy("startDate"));
 const snap=await getDocs(q);return snap.docs.map(d=>({id:d.id,...d.data()})).filter(b=>b.status!=="cancelled"&&b.endDate>=date);
}
function overlaps(a,b){return a.start<b.end && b.start<a.end}
async function renderSlots(){
 const date=$("startDate").value,root=$("standardSlots");root.innerHTML="";
 if(!date)return;
 let dayBookings=[];
 try{dayBookings=await fetchDayBookings(date)}catch(e){console.error(e)}
 const ranges=[["6 AM – 8 AM","06:00","08:00"],["8 AM – 10 AM","08:00","10:00"],["10 AM – 12 PM","10:00","12:00"],["12 PM – 2 PM","12:00","14:00"],["2 PM – 4 PM","14:00","16:00"],["4 PM – 6 PM","16:00","18:00"],["6 PM – 8 PM","18:00","20:00"],["8 PM – 10 PM","20:00","22:00"],["10 PM – 12 AM","22:00","00:00"]];
 for(const [label,st,en] of ranges){
  const endDate=en==="00:00"?new Date(toStamp(date,"00:00")+86400000).toISOString().slice(0,10):date;
  const q=makeQuote(date,st,endDate,en),past=q.start<Date.now(),busy=past||dayBookings.some(b=>overlaps(q,{start:b.startAt,end:b.endAt}));
  const el=document.createElement("button");el.className="slot";el.disabled=busy;
  el.innerHTML=`${label}<small>${past?"Time passed":busy?"Unavailable":"₹"+q.total.toLocaleString("en-IN")+" · 2 hr"}</small>`;
  if(!busy)el.onclick=()=>{document.querySelectorAll(".slot").forEach(x=>x.classList.remove("chosen"));el.classList.add("chosen");$("customStart").value=st;$("endDate").value=endDate;$("customEnd").value=en;showQuote(q)};
  root.append(el);
 }
}
$("startDate").addEventListener("change",()=>{clearQuote();$("endDate").value=$("startDate").value;$("endDate").min=$("startDate").value;renderSlots()});
$("customBtn").onclick=async()=>{
 try{const q=makeQuote($("startDate").value,$("customStart").value,$("endDate").value,$("customEnd").value);
  const bookings=await fetchDayBookings(q.startDate);
  if(bookings.some(b=>overlaps(q,{start:b.startAt,end:b.endAt})))throw Error("This time overlaps an existing booking. Please choose another time.");
  showQuote(q);
 }catch(e){notify(e.message)}
};
$("submitBooking").onclick=async()=>{
 if(!quoteData)return notify("Please select a time first.");
 const name=$("customerName").value.trim(),phone=$("customerPhone").value.trim(),note=$("customerNote").value.trim();
 if(!name||!/^[6-9]\d{9}$/.test(phone))return notify("Enter your name and valid 10-digit Indian mobile number.");
 if(!db)return notify("Online booking is not activated yet. The owner must complete Firebase setup first.");
 const q=quoteData;
 try{
  const bookingRef=doc(collection(db,"bookings"));
  await runTransaction(db,async tx=>{
   const qs=query(collection(db,"occupiedSlots"),where("groundId","==",GROUND_ID),where("startAt","<",q.end),orderBy("startAt"));
   const snap=await tx.get(qs);
   const conflict=snap.docs.some(d=>{const b=d.data();return b.status!=="cancelled"&&b.endAt>q.start});
   if(conflict)throw Error("Sorry, another customer has just booked this time. Please select another slot.");
   const common={groundId:GROUND_ID,startAt:q.start,endAt:q.end,startDate:q.startDate,startTime:q.startTime,endDate:q.endDate,endTime:q.endTime,status:"pending"};
   tx.set(bookingRef,{...common,name,phone,note,durationHours:q.hours,price:q.total,priceBreakdown:q.parts.map(p=>({label:p.label,hours:p.hours,rate:p.rate,amount:p.amount})),createdAt:serverTimestamp()});
   tx.set(doc(db,"occupiedSlots",bookingRef.id),common);
  });
  const message=`Booking request – Day & Night Box Cricket Arena\nName: ${name}\nMobile: ${phone}\nFrom: ${fmtTime(q.start)}\nTo: ${fmtTime(q.end)}\nDuration: ${q.hours} hour(s)\nEstimated amount: ₹${q.total}\nStatus: Pending admin confirmation`;
  window.open(`https://wa.me/${WA}?text=${encodeURIComponent(message)}`,"_blank");
  notify("Booking request received. It is pending until the arena confirms it.");
  clearQuote();$("customerName").value="";$("customerPhone").value="";$("customerNote").value="";renderSlots();
 }catch(e){notify(e.message||"Could not submit booking. Please try again.")}
};

if(configured){
 const app=initializeApp(firebaseConfig);auth=getAuth(app);db=getFirestore(app);
 onAuthStateChanged(auth,async u=>{
  user=u;
  if(u&&ADMIN_EMAILS.map(x=>x.toLowerCase()).includes((u.email||"").toLowerCase())){
   $("adminLogin").classList.add("hidden");$("adminPanel").classList.remove("hidden");$("adminIdentity").textContent=u.email;await renderAdmin();
  }else{$("adminPanel").classList.add("hidden");$("adminLogin").classList.remove("hidden")}
 });
}else{
 $("adminLogin").insertAdjacentHTML("beforeend","<p class='small' style='color:#a13b35'>Cloud setup required: edit firebase-config.js and deploy the included Firestore rules before live bookings can work.</p>");
}
$("adminLoginBtn").onclick=async()=>{if(!auth)return notify("Firebase setup is not complete yet.");try{await signInWithEmailAndPassword(auth,$("adminEmail").value.trim(),$("adminPassword").value)}catch(e){notify("Sign-in failed: "+e.message)}};
$("logoutBtn").onclick=()=>signOut(auth);
$("adminDate").onchange=renderAdmin;
async function renderAdmin(){
 if(!db||!user)return;
 const date=$("adminDate").value;
 try{
  const q=query(collection(db,"bookings"),where("groundId","==",GROUND_ID),where("startDate","<=",date),orderBy("startDate"));
  const snap=await getDocs(q);allAdminBookings=snap.docs.map(d=>({id:d.id,...d.data()})).filter(b=>b.endDate>=date);
  const root=$("adminBookings");root.innerHTML="";
  if(!allAdminBookings.length){root.innerHTML="<p class='muted small'>No bookings found for this date.</p>";return}
  allAdminBookings.sort((a,b)=>a.startAt-b.startAt).forEach(b=>{
   const el=document.createElement("div");el.className="booking";
   const status=b.status||"pending";
   el.innerHTML=`<div class="bookingTop"><b>${escapeHtml(b.name)} · ${escapeHtml(b.phone)}</b><span class="status ${status}">${status}</span></div><div class="meta">${fmtTime(b.startAt)} → ${fmtTime(b.endAt)}<br>${b.durationHours} hour(s) · ₹${Number(b.price).toLocaleString("en-IN")}<br>${escapeHtml(b.note||"")}</div><div class="bookingActions"><button data-status="confirmed">Confirm</button><button data-status="cancelled">Cancel</button></div>`;
   el.querySelectorAll("button").forEach(btn=>btn.onclick=async()=>{try{await updateDoc(doc(db,"bookings",b.id),{status:btn.dataset.status,updatedAt:serverTimestamp()});await updateDoc(doc(db,"occupiedSlots",b.id),{status:btn.dataset.status});notify("Booking "+btn.dataset.status);renderAdmin();renderSlots()}catch(e){notify(e.message)}});
   root.append(el);
  });
 }catch(e){notify("Could not load bookings: "+e.message)}
}
$("exportBtn").onclick=()=>{
 const rows=[["Name","Phone","Start","End","Hours","Price","Status"],...allAdminBookings.map(b=>[b.name,b.phone,fmtTime(b.startAt),fmtTime(b.endAt),b.durationHours,b.price,b.status])];
 const csv=rows.map(r=>r.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(",")).join("\n");
 const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download="day-night-bookings.csv";a.click();URL.revokeObjectURL(a.href);
};
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js").catch(()=>{});
renderSlots();

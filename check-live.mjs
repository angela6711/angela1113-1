let input='';
const value=await new Promise((resolve,reject)=>{
 const done=()=>{process.stdin.removeListener('data',read);if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();resolve(input);};
 const read=chunk=>{input+=chunk;if(input.includes('\u0003'))process.exit(130);if(input.includes('\n')||input.includes('\r'))done();};
 if(process.stdin.isTTY)process.stdin.setRawMode(true);
 process.stdin.setEncoding('utf8');process.stdin.on('data',read);process.stdin.resume();console.log('Ready for hidden service access');
});
const a=JSON.parse(value);const headers={'OAI-Sites-Authorization':'Bearer '+a.token};
for(const [path,method] of [['/api/settle','POST'],['/api/state','GET'],['/api/rate','GET']]){
 const res=await fetch(a.url+path,{method,headers,signal:AbortSignal.timeout(20000)});const data=await res.json();
 console.log(JSON.stringify({path,status:res.status,...(data.state?{version:data.version,transactions:data.state.transactions.length,settlements:data.state.settlements,startMonth:data.state.startMonth}:data)}));
}

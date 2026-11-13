import fs from 'node:fs';
const path='C:/Users/USER/Desktop/1113-1/little-ledger/app/index.html';let text=fs.readFileSync(path,'utf8');
text=text.replace("$('#page').innerHTML=demoBanner()+", "$('#page').innerHTML=(!canWrite?'<div class=\"demo\"><span>公開瀏覽 · 正式帳目僅限擁有者修改</span><a href=\"/signin-with-chatgpt?return_to=%2F\" target=\"_top\">擁有者登入</a></div>':'')+demoBanner()+");
text=text.replace("[tab]||renderHome)();}", "[tab]||renderHome)();if(!canWrite&&!demo)document.querySelectorAll('.quick-actions button,.toggle,[aria-label=\"新增紀錄\"],[aria-label=\"新增固定支出\"]').forEach(button=>button.disabled=true);}");
text=text.replace("'<p class=\"notice\">這筆紀錄已列入月結報表，鎖定保存中。</p>'", "(!canWrite&&!demo?'<p class=\"notice\">公開瀏覽模式，僅帳本擁有者能修改紀錄。</p>':'<p class=\"notice\">這筆紀錄已列入月結報表，鎖定保存中。</p>')");
fs.writeFileSync(path,text);

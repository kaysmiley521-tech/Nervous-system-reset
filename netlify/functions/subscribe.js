const crypto = require('node:crypto');

exports.handler = async (event) => {
  const headers = {'Content-Type':'application/json','Cache-Control':'no-store'};
  const reply = (statusCode, body) => ({statusCode,headers,body:JSON.stringify(body)});
  if(event.httpMethod !== 'POST') return reply(405,{ok:false,message:'Method not allowed'});
  let input;
  try {input=JSON.parse(event.body||'{}');}catch{return reply(400,{ok:false,message:'Invalid submission'});}
  // Honeypot: no API call and no error to reveal spam detection.
  if(input.website) return reply(200,{ok:true});
  const firstName=String(input.firstName||'').trim().slice(0,100);
  const lastName=String(input.lastName||'').trim().slice(0,100);
  const email=String(input.email||'').trim().toLowerCase();
  const rawPhone=String(input.phone||'').trim();
  if(!firstName||!lastName||!email||!rawPhone||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return reply(400,{ok:false,message:'Please enter all four details.'});
  // UK national phone numbers are normalised to E.164 for Mailchimp's Phone field.
  let phone=rawPhone.replace(/[\s()\-]/g,'');
  if(phone.startsWith('00'))phone='+'+phone.slice(2);
  if(phone.startsWith('0'))phone='+44'+phone.slice(1);
  if(!/^\+[1-9]\d{6,14}$/.test(phone))return reply(400,{ok:false,message:'Please enter a valid phone number, including the country code if outside the UK.'});
  const apiKey=process.env.MAILCHIMP_API_KEY;
  const audience=process.env.MAILCHIMP_AUDIENCE_ID || '8f214d2c50';
  if(!apiKey || !apiKey.includes('-'))return reply(503,{ok:false,message:'The signup connection is not configured yet.'});
  const dc=apiKey.split('-').pop();
  const base=`https://${dc}.api.mailchimp.com/3.0/lists/${encodeURIComponent(audience)}`;
  const auth='Basic '+Buffer.from('netlify:'+apiKey).toString('base64');
  const hash=crypto.createHash('md5').update(email).digest('hex');
  try {
    const resp=await fetch(`${base}/members/${hash}`,{
      method:'PUT',headers:{'Authorization':auth,'Content-Type':'application/json'},
      body:JSON.stringify({email_address:email,status_if_new:'subscribed',merge_fields:{FNAME:firstName,LNAME:lastName,PHONE:phone}})
    });
    const data=await resp.json();
    if(!resp.ok){
      console.error('Mailchimp member error',resp.status,data.title,data.detail);
      return reply(422,{ok:false,message:'Mailchimp could not save your details. Please check your phone number and try again.'});
    }
    // Tagging is supplementary; failure must not falsely indicate that signup failed.
    const tagResp=await fetch(`${base}/members/${hash}/tags`,{
      method:'POST',headers:{'Authorization':auth,'Content-Type':'application/json'},
      body:JSON.stringify({tags:[{name:'NS Reset - Landing Page',status:'active'}]})
    });
    if(!tagResp.ok)console.error('Mailchimp tagging failed',tagResp.status);
    return reply(200,{ok:true});
  }catch(err){console.error('Mailchimp network error',err);return reply(502,{ok:false,message:'We could not complete your signup. Please try again.'});}
};

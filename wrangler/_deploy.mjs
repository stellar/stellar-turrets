//DONT USE THIS ONE USE THE OTHER ONE! WIP ALERT

/**
 * Configures and Deploys to Cloudflare. Enjoy! Usage:
 *
 *   $ npm deploy [--env testnet]
 *
 * @see https://developers.cloudflare.com/workers/
 * @see https://api.cloudflare.com/#worker-script-upload-worker
 */
import * as cp from 'node:child_process'
//import {exec} from 'ChildProcess'
import fs from "fs"
import got from 'got'
import path from "path"
import {globby} from "globby"
import minimist from "minimist"
import FormData from "form-data"
import dotenv from "dotenv"
import {fileURLToPath} from 'url';
import { EOL } from "os"
import * as readline from 'node:readline';
import { ChildProcess } from "child_process"

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
})
const readInput = (input, output) => {
  return new Promise((resolve, reject) => {
    try{
      rl.question(`Enter your ${input}: `, (output) => {
        resolve(output)
      })
    }catch(err){
      reject(err)
    }
    
  })
}

let configVars= {}

configVars.CLOUDFLARE_ACCOUNT_ID = await readInput('CLOUDFLARE_ACCOUNT_ID=')
console.log(configVars)


configVars.CLOUDFLARE_API_KEY = await readInput('CLOUDFLARE_API_KEY')
console.log(configVars)




console.log('%c Stellar Turrets Deployment Helper', 'color: red')

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const args = minimist(process.argv.slice(2));

console.log(`started with: ${args}`)
 
const buildDir = path.resolve(__dirname, "./dist");
console.log(`using builddir: ${buildDir}`)

// The environment to work from
const envName = args.env || "testnet";

 // Load environment variables from the .env file
 if (envName != "testnet"){
  dotenv.config({ path: `.env.${envName}` });
 }
 dotenv.config({ path: `.env` });

 const env = process.env;
  
 //console.log(env)
 
 function execShellCommand(cmd) {
  return new Promise((resolve, reject) => {
  cp.exec(cmd, { maxBuffer: 1024 * 500 }, (error, stdout, stderr) => {
    if (error) {
      //console.warn(error);
      reject(error);
    } else if (stdout) {
      //console.log(stdout); 
      resolve((stdout || stderr).trim());
    } reject(error)
    
  });
});
}

 function getAccountId() {
  return new Promise((resolve, reject) => {
      const output = execShellCommand(`npx wrangler whoami`).then((val) => {
          try{
              const acctrxp = /\s\|\s[A-Za-z0-9]{32}/g
              const match = val.match(acctrxp)
              const accountid = JSON.stringify(match).slice(5, 37)
              console.log('########## WRANGLER_ACCOUNT_ID ##########')
              resolve(accountid)
          }catch(err){
              reject(err)
          }
      })})}
getAccountId().then(val => console.log(val))
 // Configure an HTTP client for accessing Cloudflare REST API
const cf = got.extend({
   prefixUrl: `https://api.cloudflare.com/client/v4/accounts/${configVars.CLOUDFLARE_ACCOUNT_ID}/`,
   headers: { authorization: `Bearer ${configVars.CLOUDFLARE_API_TOKEN}` },
   responseType: "json",
   resolveBodyOnly: true,
   hooks: {
     afterResponse: [
       (res) => {
         console.log(res)
         if (!res.body?.success) throw new Error(res.body.errors[0].message);
         res.body?.messages.forEach((x) => console.log(x));
         res.body = res.body.result || res.body;
         return res;
       },
     ],
   },
 });
 

 async function deploy() {
   if (args._.length === 0) {
     throw new Error("Need to specify script(s) to deploy.");
   }
 
   const pattern = args._.map((x) => `${x}.js`);
 
   const files = await globby(pattern, { cwd: buildDir });
 
   for (const file of files) {
     const worker =
       file.substring(0, file.length - 3) +
       (envName === "prod" ? "" : `-${envName}`);
     console.log(`Uploading Cloudflare Worker script: ${worker}`);
 
     const form = new FormData();
     const script = fs.readFileSync(path.resolve(buildDir, file), {
       encoding: "utf-8",
     });
     const bindings = [];
     const metadata = { body_part: "script", bindings };
     form.append("script", script, { contentType: "application/javascript" });
     form.append("metadata", JSON.stringify(metadata), {
       contentType: "application/json",
     });
 
     await cf.put({
       url: `workers/scripts/${worker}`,
       headers: form.getHeaders(),
       body: form,
     });
   }
 
   console.log("Done!");
 }
 
 deploy().catch((err) => {
   console.error(err);
   process.exit(1);
 });
 
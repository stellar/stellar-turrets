import * as cp from "node:child_process";
import dotenv from "dotenv";
import {
    fileURLToPath
} from "url";
import {
    EOL
} from "os";
import * as readline from "node:readline";
import path from "path";
import {
    Keypair
} from "stellar-base";
import * as TOML from "toml";
import fs from "fs";

import {
    ChildProcess,
    spawnSync
} from "node:child_process";
const __filename = fileURLToPath(
    import.meta.url);
const __dirname = path.dirname(__filename);
const buildDir = path.resolve(__dirname, "./dist");
let cfconfig = {};
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    crlfDelay: Infinity,
});

const readInput = (input = {}, output) =>
    new Promise((resolve, reject) => {
        try {
            let defaultval = input.default ? input.default : undefined;
            let question = input.message.pop();
            for (let i = 0; i < input.message.length; i++) {
                let outputl = console.log(input.message.shift());
            }
            rl.question(`${question}(Default: ${input.default}): `, (output) => {
                //TODO: account for required inputs. !defaultval
                if (input.required === true && output.length < 1) {
                    throw "This Input Is REQUIRED";
                }
                if (output.length > 0 || !defaultval) resolve(output);
                resolve(defaultval);
            });
        } catch (err) {
            reject(err);
        }
    });

function execShellCommand(cmd) {
    return new Promise((resolve, reject) => {
        cp.exec(cmd, {
            maxBuffer: 1024 * 500
        }, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            } else if (stdout) {
                resolve((stdout || stderr).trim());
            }
            reject(error);
        });
    });
}

function getAccountId() {
    return new Promise((resolve, reject) => {
        const output = execShellCommand(`npx wrangler whoami`).then((val) => {
            try {
                const acctrxp = /\s\|\s[A-Za-z0-9]{32}/g;
                const match = val.match(acctrxp);
                if (match) {
                    console.log(match);
                }
                const accountid = JSON.stringify(match).slice(5, 37);
                console.log("########## WRANGLER_ACCOUNT_ID ##########");
                resolve(accountid);
            } catch (err) {
                reject("err");
            }
        });
    });
}
/**
 * @description - initializes the config for wrangler
 * @function cfconfig.init()
 * @returns Promise<void>
 */
cfconfig.init = async function () {
    let thenetwork;
    let login = await getAccountId()
        .then((val) => {
            cfconfig.accountid = val;
            console.log("here", val);
        })
        .catch((err) => console.error('please run "npx wrangler login"'));
    cfconfig.envr = await readInput({
        message: ["(P)ublic or (T)estnet (default=testnet)?"],
        default: "testnet",
    });
    if (!cfconfig.envr || cfconfig.envr[0].toUpperCase() === "T") {
        console.log("network set to testnet");
        thenetwork = "testnet";
    } else {
        console.log("network set to public");
        thenetwork = "public";
    }
    cfconfig.turretrunnerkeypair = Keypair.random();
    console.log(
        `Random keypair created.  Please use the following public key for your SLS deployment:${EOL}${cfconfig.turretrunnerkeypair.publicKey()}`
    );
    await readInput({
        message: [
            `Do you want to specify a custom keypair for your runner?`,
            `If so please input the secret when prompted, otherwise`,
            `copy the random key generated and enter that.`,
        ],
        default: cfconfig.turretrunnerkeypair.secret(),
    }).then((val) => {
        try {
            if (val.length != 56) {
                console.log("you have entered an invalid secret key. using default.");
                rl.output(cfconfig.turretrunnerkeypair.secret());
            } else if (val != cfconfig.turretrunnerkeypair.secret()) {
                cfconfig.turretrunnerkeypair = new Keypair.fromSecret(val);
            }
            cfconfig.turretrunnersecret = cfconfig.turretrunnerkeypair.secret();
        } catch (err) {
            console.error(
                "your keypair did not validate or failed., the keypair used was ",
                cfconfig.turretrunnersecret
            );
        }
    });

    cfconfig.TURRET_RUN_URL = await readInput({
        message: [
            `Please go and deploy your TXFunction runner using SLS.`,
            `While deploying SLS, make sure to use the correct TURRET_AUTH_KEY`,
            `This is the pubkey counterpart to the secret key you entered above.`,
            `The TURRET_AUTH_KEYAIR does not need to be the same as your`,
            `TURRET_FEE_KEYPAIR as it is only used to secure communications`,
            `between the API and the runner.`,
            `Press Enter the full URL including https://`,
        ],
        default: undefined,
        required: true,
    });
    cfconfig.envr = thenetwork;
    cfconfig.STELLAR_NETWORK = thenetwork.toUpperCase();
    cfconfig.WRANGLER_WORKER_NAME = `turrets-api-${thenetwork}`;
    cfconfig.XLM_FEE_MIN = await readInput({
        message: [`Minumum accepted value for fee deposit`],
        default: 1,
    });
    cfconfig.XLM_FEE_MAX = await readInput({
        message: [`Maximum accepted value for fee deposit`],
        default: 10,
    });
    cfconfig.UPLOAD_DIVISOR = await readInput({
        message: [`Divisor used to calculate testnet txFunction upload price.`],
        default: 1000,
    });
    cfconfig.RUN_DIVISOR = await readInput({
        message: [`Runtime is divided by this number to calculate fee`],
        default: 1000000,
    });
    cfconfig.TURRET_ADDRESS = await readInput({
        message: [
            `Stellar Account used for Turret Fees`,
            `This should be an account dedicated, with it's home domain set to your API url root`,
        ],
        default: "GAISK5PUCLQYJOS6Y7GTTZM3PZQRGDA2YLCHNN4O5XGNL24QYEZH2RGP",
    });
    if (cfconfig.TURRET_ADDRESS.length < 56) {
        throw "the turret address is required, but the one you entered is invalid.";
    }
    let horizondefault =
        cfconfig.STELLAR_NETWORK === "PUBLIC" ?
        "https://horizon.stellar.org" :
        "https://horizon-testnet.stellar.org";
    cfconfig.HORIZON_URL = await readInput({
        message: [`The URL of the Horizon server you wish to use`],
        default: horizondefault,
    });
};

/**
 * @description creates the inital toml for wrangler from the config initializer
 * @function cfconfig.initWranglerToml
 * @param stage - temp or final - defines which toml is being created.
 * @returns Promise<string> - Returns a toml formatted string.
 */
cfconfig.initWranglerToml = async function (input = {
    stage
}) {
    const {
        stage
    } = input;
    const obj = `type = "javascript"
        account_id = "${cfconfig.accountid}"
        usage_model = "bundled"
        workers_dev = true
        compatibility_date = "2021-10-03"
        [env.${cfconfig.envr}]
        name = "${cfconfig.WRANGLER_WORKER_NAME}"
        `;
    if (stage === "final") {
        const obj2 = `
        `;
    }
    const str = obj.toString();
    return str;
};

async function addcloudflaresecret(secret) {
    try {
        await readInput({
            message: [
                "you now need to upload the secret to cloudflare workers.",
                "If this fails you will need to manually specify it with the given command, then re-run the deploy script.",
                `The Command is:  npx wrangler secret put TURRET_SIGNER --config wrangler.toml --env ${cfconfig.envr}`,
            ],
            default: null,
        });
        let iface = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        iface.setPrompt("PRESS ENTER TO CONTINUE> ");
        let mydata;
        iface.prompt(true);
        iface.on("line", (line) => {
            iface.pause(); // PAUSING STDIN!
            process.stdin.setRawMode(true);
            const ab = cp.spawn(
                `npx.cmd`,
                [
                    "wrangler",
                    "secret",
                    "put",
                    "testsecret01",
                    `-c`,
                    `temp.toml`,
                    "-e",
                    "testnet",
                ], {
                    stdio: [0, 1, 2],
                    env: process.env,
                    cwd: `${__dirname}`
                }
            );

            ab.on("exit", (code, signal) => {
                console.log("the code", code);
                console.log("the signal", signal);
            });
            process.stdin.setRawMode(false);
        });
        return mydata;
    } catch (err) {
        throw err;
    }
}

/**
 * @description Creates a KV namespace with wrangler cli.
 * @function createkvnamespace()
 * @param {*} [kvmeta={ bindingname, cfinitconfigfile }] - binding name is the name of the kv namespace to create, the path to the temp toml
 * @param {*} reject for error
 * @return {*} Promise<void>
 */
const createkvnamespace = async (
    kvmeta = {
        bindingname,
        cfinitconfigfile
    }
) => {
    try {
        const {
            bindingname,
            cfinitconfigfile
        } = kvmeta;
        return await execShellCommand(
                `npx wrangler --config ${cfinitconfigfile} --env ${cfconfig.envr} kv:namespace create ${bindingname}`
            )
            .then((val) => parsebinding(val))
            .then((val) => console.log(val));
    } catch (err) {
        return err;
    }
};

/**
 * @description - parses the output from wrangler cli to return the bindingid and binding name
 * @function parsebinding()
 * @param {*} wrangleroutput
 * @return {Promise<string>} bindingid returns a promise of bindingid
 */
const parsebinding = async (wrangleroutput) => {
    return new Promise((resolve, reject) => {
        try {
            //console.log(wrangleroutput)
            if (wrangleroutput.includes("a namespace with this account")) {
                console.log(
                    "ERROR ERROR ERROR the namespace was already created, what are you doing?"
                );
                reject(wrangleroutput);
            }
            const cfidrxp = /\s=\s"[A-Za-z0-9]{32}/;
            const idmatch = wrangleroutput.match(cfidrxp);
            const bindingid = JSON.stringify(idmatch).slice(7, 39);
            const bindingname = wrangleroutput
                .match(/[b][i][n][d][i][n][g]\s=\s"[a-z0-9A-Z_]+"/)[0]
                .split(" = ")[1]
                .slice(
                    1,
                    wrangleroutput
                    .match(/[b][i][n][d][i][n][g]\s=\s"[0-9a-zA-Z_]+"/)[0]
                    .split(" = ")[1].length - 1
                );
            console.log("########## BINDING NAME ########");
            if (bindingname) {
                console.log(bindingname);
            }
            console.log("########## BINDING ID ##########");
            if (bindingid) {
                console.log(bindingid);
            }
            resolve(bindingid);
        } catch (err) {
            reject("err");
        }
    });
};

cfconfig.env = async function () {
    const str =
        `
        STELLAR_NETWORK = "${cfconfig.STELLAR_NETWORK}"${EOL}
        HORIZON_URL = "${cfconfig.HORIZON_URL}"${EOL}
        TURRET_ADDRESS = "${cfconfig.TURRET_ADDRESS}"${EOL}
        TURRET_RUN_URL = "${cfconfig.TURRET_FUNCTION_RUNNER_URL}"${EOL}
        XLM_FEE_MIN = ${cfconfig.WRANGLER_XLM_FEE_MIN}${EOL}
        XLM_FEE_MAX = ${cfconfig.WRANGLER_XLM_FEE_MAX}${EOL}
        UPLOAD_DIVISOR = ${cfconfig.WRANGLER_UPLOAD_DIVISOR}${EOL}
        RUN_DIVISOR = ${cfconfig.RUN_DIVISOR}${EOL}
        SLS_TIMEOUT = ${cfconfig.SLS_TIMEOUT}${EOL}
        HORIZON_URL = "${cfconfig.HORIZON_URL}"${EOL}
        WRANGLER_META = "${kv_namespaces.META}"${EOL}
        WRANGLER_TX_FUNCTIONS = "${kv_namespaces.TX_FUNCTIONS}"
        WRANGLER_ALLOWED = "${kv_namespaces.ALLOWED ? kv_namespaces.ALLOWED : null}"`
    const dotenvfile = path.resolve(__dirname, `.env.${cfconfig.envr}`);
    const temptoml = fs.writeFileSync(dotenvfile, str, {
        encoding: "utf8",
        flag: "w+",
        mode: 0o666,
    });
    return (str)
};
async function main() {
    try {
        const config = await cfconfig.init();

        const envstring = `[env.${cfconfig.envr}]`;
        console.log(envstring);
        console.log(cfconfig);
        //initialize the settings toml in preparation to create the bindings, DO, then upload worker.
        const inittoml = await cfconfig
            .initWranglerToml({
                stage: "temp"
            })
            .then((val) => Buffer.from(val));

        const cfinitconfigfile = path.resolve(__dirname, "temp.toml");
        const temptoml = fs.writeFileSync(cfinitconfigfile, inittoml, {
            encoding: "utf8",
            flag: "w+",
            mode: 0o666,
        });

        console.log(`temp init file created ${cfinitconfigfile}`);
        const kv_namespaces = {}
            const METANAMESPACE = await createkvnamespace({
                bindingname: "META",
                cfinitconfigfile
            }).then(
                (val) => {
                    kv_namespaces.META = val;
                    console.log(val);
                    return val
                }
            );
            const TXFUNCTIONNAMESPACE = await createkvnamespace({
                bindingname: "TX_FUNCTIONS",
                cfinitconfigfile
            }).then(
                (val) => {
                    kv_namespaces.TX_FUNCTIONS = val;
                    console.log(val);
                    return val
                }
            );
            if (cfconfig.envr === "public") {
                const ALLOWEDNAMESPACE = await createkvnamespace({
                    bindingname: "ALLOWED",
                    cfinitconfigfile
                }).then(
                    (val) => {
                        kv_namespaces.ALLOWED = val;
                        console.log(val);
                        return val
                    }
                );
            }
            if(cfconfig.envr === 'public') {
                kv_namespaces = {
                    WRANGLER_META: METANAMESPACE,
                    TX_FUNCTIONS: TXFUNCTIONNAMESPACE,
                    ALLOWED: ALLOWEDNAMESPACE
                }        
            }
        kv_namespaces = {
            WRANGLER_META: METANAMESPACE,
            TX_FUNCTIONS: TXFUNCTIONNAMESPACE
        }
        console.log(kv_namespaces);
        console.log("building wrangler.toml");
        execShellCommand(`npx envsub .env.${cfconfig.envr} wrangler.toml.dist wrangler.toml`)
        console.log("building api code");
        execShellCommand(`npx webpack`)
        console.log("publishing template worker");
        execShellCommand(`npx wrangler publish --env ${cfconfig.envr} --new-class TxFees`)
        console.log("creating cf secret");
        const mysecret = addcloudflaresecret(cfconfig.turretrunnerkeypair.secret());
        console.log('initializing txfees')
        execShellCommand(`npx wrangler publish --env ${cfconfig.envr}`)
        console.log('the deploy appears to be successful. check your cloudflare dashboard at https://dash.cloudflare.com')
        console.log(mysecret);
    } catch (err) {
        console.error(`The deployment failed because of an error; try again or attempt manual deployment. ${err}`);
    }
};
await main().then(val => {
    fs.unlink(cfinitconfigfile, (err) => {
        if (err) {
          console.error(err);
        } else {
          console.log("File removed:", cfinitconfigfile);
        }
      });
  });

//delete the file

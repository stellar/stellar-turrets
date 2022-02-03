import { Keypair, TransactionBuilder, Networks, BASE_FEE, Operation, Account } from 'stellar-base'
import { parse } from 'toml'
import localtoml from '../turret/toml'

/**
 * It gets the account info for a given public key.
 * @param pubkey - The public key of the account you want to get information about.
 * @returns The JSON response from the Horizon API.
 */
export async function getAccountInfo(pubkey){
    const accountInfo = (await fetch(`${HORIZON_URL}/accounts/${pubkey}`))
    return accountInfo.json()
}

/**
 * It gets all the accounts that are signed on by the given public key.
 * @param pubkey - The public key of the signer you want to get the accounts of.
 * @returns An array of account IDs that are signed by the given public key.
 */
export async function getAccountsOfSigner(pubkey) {
    const signedOnAccounts = []
    const getrecords = async(url) => await fetch(url)
    const signerinfo = await (await getrecords(`${HORIZON_URL}/accounts/?signer=${pubkey}&limit=200`)).json()
    signerinfo._embedded.records.map((record) => {
        signedOnAccounts.push(record.account_id)
    })
    return signedOnAccounts
}

/**
 * It gets the signers on an account.
 * @param pubkey - The public key of the account you want to get the signers for.
 * @returns an array of public keys that are associated with the account.
 */
export async function getSignersOnAccount(pubkey) {
    const signers = []
    const accountInfo = await getAccountInfo
    accountInfo.signers.map((signer) =>{
        signers.push(signer.key)
    })
    return signers
}


/**
 * Get the home domain of a turret account
 * @param turretaddress - The address of the turret you want to get the home domain of.
 * @returns The home domain of the account.
 */
export async function getTurretHomeDomain(turretaddress) {
    const turretaccountinfo = await getAccountInfo(turretaddress)
    return turretaccountinfo.home_domain
}

/**
 * It returns the data entries for a given account.
 * @param pubkey - The public key of the account you want to get the data entries for.
 * @returns a dictionary with two keys: signer and turret. For example signer[0] equates to turret[0]
 */
export async function getSourceAccountSignerDataEntries(pubkey) {
    const data = {
        signer: [],
        turret: []
    }
    const accountInfo = await getAccountInfo(pubkey)
    const dataentries = accountInfo.data
    for(const index in dataentries){
        const turretmatch = index.match(/[t][u][r][r][e][t][.]/g)
        const addrmatch = index.match(/[G][A-Za-z0-9]{55}/g);
        if (turretmatch && addrmatch){
            data.signer.push(addrmatch[0])
            const turretaddress = atob(dataentries[index])
            data.turret.push(turretaddress)
        }
    }
    return data
}

/**
 * It gets the signer of a TxFunction for a specific turret.
 * @param txfunctionhash - the hash of the TxFunction you want the signer for
 * @param turretpubkey - the public key address of the turret you want to use 
 * @returns The signer for the txFunction.
 */
export async function getTxFunctionSigner(txfunctionhash, turretpubkey) {
    const turrethomedomain = await getHomeDomain(turretpubkey)
    const txf = await (await fetch(`https://${turrethomedomain}/tx-functions/${txfunctionhash}`)).json()
    return txf.signer
}

/**
 * Given a public key, return the home domain of the account
 * @param pubkey - The public key of the account you want to get the home domain of.
 * @returns The home domain of the account.
 */
export async function getHomeDomain(pubkey) {
    const turretaccountinfo = getAccountInfo(pubkey)
    if (turretaccountinfo.home_domain){
        return turretaccountinfo.home_domain
    } return undefined
}
/**
 * It gets the signer for the TxFunction for the local turret.
 * @param txfunctionhash - The hash of the TxFunction you want the signer for.
 * @returns The function signer's public key.
 */
export async function getLocalFunctionSigner(txfunctionhash){
    const { value, metadata } = await TX_FUNCTIONS.getWithMetadata(txfunctionhash, 'arrayBuffer')
    if (!value)
        throw {status: 404, message: `txFunction could not be found this turret`}
    const { txFunctionSignerPublicKey } = metadata
    return txFunctionSignerPublicKey
}

/**
 * It returns the high threshold for the account.
 * @param pubkey - The public key of the account you want to get the threshold for.
 * @returns the high_threshold value.
 */
export async function getAccountThreshold(pubkey){
    const sourceaccountinfo = await getAccountInfo(pubkey)
    const requiredthreshold = sourceaccountinfo.thresholds.high_threshold
    if (requiredthreshold)
        return requiredthreshold
    throw ('unable to obtain threshold information')
}

/**
 * It returns the weight of a signer for a given account.
 * @param signer - The public key of the signer you want to get the weight of
 * @param account - the account to get the signer weight for
 * @returns The weight of the signer.
 */
export async function getSignerWeight(signer, account){
    const accountinfo = await getAccountInfo(account)
    const accountsigners = accountinfo.signers
    for (const signer in accountsigners){
        if (accountsigners[signer].key.includes(signer))
            return accountsigners[signer].weight
    }
    throw (`the signer ${signer} is not a signer for account ${account}`)
}
/**
 * Get the sequence number for a given public key
 * @param pubkey - The public key of the account you want to get the sequence number for.
 * @returns The sequence number of the account.
 */
export async function getSequenceNumber(pubkey){
    accountinfo = getAccountInfo(pubkey)
    return accountinfo.sequence
}
/**
 * This function checks the local toml to see if the turret address is trusted
 * @param turret - the address of the turret you want to check for trust
 * @returns A boolean value.
 */
export async function checkLocalQuorem(turret) {
    const localquorem = localtoml()
    try{
        const thetoml = parse(localquorem).TSS.TURRETS
        const quorem = []
        for (const each in thetoml){
            quorem.push(thetoml[each])
        }
        if(quorem.includes(turret))
            return true
        return false
    }catch(err){
        throw(`the local toml had a problem ${err}`)
    }
}

/**
 * The heal function is used to add or remove a signer from a source account
 * @param sourceaccount - the account that the signer is being swapped on
 * @param oldturret - the address of the turret that is being removed from the source account
 * @param newturret - the new turret to add to the source account
 * @param functionhash - the hash of the function that is being healed
 * @returns The transaction XDR, the signer public key, and the signature.
 */
export async function heal(sourceaccount, oldturret, newturret, functionhash) {
    try{
        /* check that the turret is not trying to heal itself */
        if (newturret === TURRET_ADDRESS || oldturret === TURRET_ADDRESS)
            throw ('A Turret may not add or remove itself to a control account')
        /* gather source account signers */
        const sourceaccountsigners = await getSignersOnAccount(sourceaccount)
        /* find the local signer for given functionhash */
        const localsigner = await getLocalFunctionSigner(functionhash)
        /* verify the local signer is a signer on the source account */
        if(!sourceaccountsigners.includes(localsigner))
            throw (`This turret is not a signer on ${functionhash}, what are you doing?`)
        /* gather the signer/turret managedata entries from the source account */
        const sourceaccountmanagedatasigners = await getSourceAccountSignerDataEntries(sourceaccount)
        /* check that the manage data does not yet include the new turret */
        if (sourceaccountmanagedatasigners.turret.includes(newturret))
            throw (`The New turret is already listed in the managedata entries for account`)
        /* check that the oldturret is listed on the source account managedata entries */
        if (!sourceaccountmanagedatasigners.turret.includes(oldturret))
            throw (`The old turret is not listed as a signer in the manage data entries`)
        /* get the signer address to remove from the managedata entries on the source account */
        const signertoremoveindex = sourceaccountmanagedatasigners.turret.findIndex(checkaddr);
        const removesigner = sourceaccountmanagedatasigners.signer[signertoremoveindex]
        function checkaddr(key) {
            return key === oldturret;
        }
        /* get the new signer address from the new turret */
        const newturretsigner = await getTxFunctionSigner(functionhash, newturret)
        /* verify the new turret is not already a signer on the source account */
        if (sourceaccountsigners.includes(newturretsigner))
            throw (`The new turret signer ${newturretsigner} is already a signer on sourceaccount ${sourceaccount}`)
        /* assign the new signer weight by getting the old signer weight */
        const signerweight = await getSignerWeight(removesigner, sourceaccount)
        /* check the local toml to validate the new turret is part of the trust quorem and the old turret is not.*/
        const newtrust = await checkLocalQuorem(newturret)
        if (!newtrust){
            throw (`the new turret is not trusted by the local turret quorem, make sure it is added to its toml.`)
        }
        const oldtrust = await checkLocalQuorem(oldturret)
        if (oldtrust){
            throw (`the old turret is still trusted by the local quorem and can't be removed`)
        }
        /* get the sourceaccount sequence number */
        const sourcesequence = getSequenceNumber(sourceaccount)
        /* Create a new transaction for source account*/
        const transaction = new TransactionBuilder(
            new Account(sourceaccount, sourcesequence),{
                fee: BASE_FEE,
                networkPassphrase: Networks[STELLAR_NETWORK]
            }
        /* add the operation to add the new signer */
        ).addOperation(Operation.setOptions({
            signer: {
                ed25519PublicKey: newturretsigner,
                weight: signerweight
            }
        /* add the operation to remove the old signer */
        })).addOperation(Operation.setOptions({
            signer: {
                ed25519PublicKey: removesigner,
                weight: 0
            }
        /* add the operation to remove the old managedata entry */
        })).addOperation(Operation.manageData({
            name: `turret.${removesigner}`,
            value: null,
        /* add the operation to add the new managedata entry */
        })).addOperation(Operation.manageData({
            name: `turret.${newturretsigner}`,
            value: newturret,
          }))
          .setTimeout(0)
          /* build the transaction */
          .build()

          /* generate the signature */
          const { txFunctionSignerPublicKey, txFunctionSignerSecret } = metadata

          const txFunctionSignerKeypair = Keypair.fromSecret(txFunctionSignerSecret)
          const txFunctionSignature = txFunctionSignerKeypair.sign(transaction.hash()).toString('base64')
          /* return the info for the response */
          const returndata = {
            xdr: transaction.toXDR(),
            signer: txFunctionSignerPublicKey,
            signature: txFunctionSignature
          }
          return returndata
    }catch(err){
        throw({status: 500, message:`heal failed, ${err}`})
    }
}
import {
  Keypair,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Operation,
  Account,
} from 'stellar-base';
import { parse } from 'toml';
import { loadAccount } from '../@utils/stellar-sdk-utils';
import localtoml from '../turret/toml';

export const TURRET_DATA_KEY = (turretAccountId) => `turret.${turretAccountId}`;

/**
 * It gets the signer of a TxFunction for a specific turret.
 * @param {string} txFunctionHash - the hash of the TxFunction you want the signer for
 * @param {string} turretPubkey - the public key address of the turret you want to use
 * @returns {Promise<string | undefined>} The signer for the txFunction.
 * Returns undefined if the TxFunctionSigner was not able to be resolved.
 */
export async function getTxFunctionSigner(txFunctionHash, turretPubkey) {
  try {
    const turretHomeDomain = await getHomeDomain(turretPubkey);
    const txf = await (
      await fetch(`https://${turretHomeDomain}/tx-functions/${txFunctionHash}`)
    ).json();
    return txf.signer;
  } catch (e) {
    // unable to fetch turret, nothing found
    return undefined;
  }
}

/**
 * Given a public key, return the home domain of the account
 * @param pubkey - The public key of the account you want to get the home domain of.
 * @returns The home domain of the account.
 */
export async function getHomeDomain(pubkey) {
  const turretaccountinfo = loadAccount(pubkey);
  if (turretaccountinfo.home_domain) {
    return turretaccountinfo.home_domain;
  }
  return undefined;
}
/**
 * It gets the signer for the TxFunction for the local turret.
 * @param {string} txFunctionHash - The hash of the TxFunction you want the signer for.
 * @returns {Promise<string>} The function signer's public key.
 */
export async function getLocalFunctionSigner(txFunctionHash) {
  const { value, metadata } = await TX_FUNCTIONS.getWithMetadata(
    txFunctionHash,
    'arrayBuffer'
  );
  if (!value) {
    throw { status: 404, message: `txFunction could not be found this turret` };
  }
  const { txFunctionSignerPublicKey } = metadata;
  return txFunctionSignerPublicKey;
}

/**
 * This function checks the local toml to see if the turret address is trusted
 * @param turret - the address of the turret you want to check for trust
 * @returns {boolean} A boolean value.
 */
export function checkLocalQuorum(turret) {
  const localquorum = localtoml({ env });
  try {
    const thetoml = parse(localquorum).TURRETS;
    const quorum = [];
    for (const each in thetoml) {
      quorum.push(thetoml[each].PUBLIC_KEY);
    }
    if (quorum.includes(turret)) return true;
    return false;
  } catch (err) {
    throw `the local toml had a problem ${err}`;
  }
}

/**
 * The heal function is used to add or remove a signer from a source account
 * @param {string} controlAccount - the account under Turret control that is having Turrets swapped
 * @param {string} oldTurret - the address of the turret that is being removed from the source account
 * @param {string} newTurret - the new turret to add to the source account
 * @param {string} functionHash - the hash of the function that is being healed
 * @returns {Promise<string>} The transaction XDR, the signer public key, and the signature.
 */
export async function heal(controlAccount, oldTurret, newTurret, functionHash) {
  try {
    // check that the turret is not trying to heal itself
    if (newTurret === TURRET_ADDRESS || oldTurret === TURRET_ADDRESS) {
      throw new Error(
        'A Turret may not add or remove itself to a control account'
      );
    }

    // check the local toml to validate the new turret is part of the trust quorum and the old turret is not
    const newtrust = checkLocalQuorum(newTurret);
    if (!newtrust) {
      throw `The new turret is not trusted by the local turret quorum, make sure it is added to its toml`;
    }
    const oldtrust = checkLocalQuorum(oldTurret);
    if (oldtrust) {
      throw `The old turret is still trusted by the local quorum and can't be removed`;
    }

    // load the control account
    const controlAccountRecord = await loadAccount(controlAccount);

    // validate this turret is a signer on the control account
    const localSignerKey = await getLocalFunctionSigner(functionHash);
    if (controlAccountRecord.signers.some((s) => s.key === localSignerKey)) {
      throw `This turret is not a signer on ${functionHash}, what are you doing?`;
    }

    // gather the old signer/turret from the control account
    // validate it is currently a signer on the control account
    const removeSignerKey =
      controlAccountRecord.data[TURRET_DATA_KEY(oldTurret)];
    const removeSignerObj = controlAccountRecord.signers.find(
      (s) => s.key === removeSignerKey
    );
    if (removeSignerKey == undefined || removeSignerObj == undefined) {
      throw `The old turret is not listed as a signer.`;
    }

    // fetch the newSigner from the newTurret
    // validate newSigner is not already a signer on the control account
    if (controlAccountRecord.data[TURRET_DATA_KEY(newTurret)]) {
      throw `The new turret is already listed in the managedata entries for account`;
    }
    const newSignerKey = await getTxFunctionSigner(functionHash, newTurret);
    if (!newSignerKey) {
      throw `Unable to find contract on new Turret`;
    }
    const newSignerObj = controlAccountRecord.signers.find(
      (s) => s.key === newSignerKey
    );
    if (newSignerObj) {
      throw `The new turret signer ${newSignerKey} is already a signer on controlAccount ${controlAccount}`;
    }

    // create a new transaction for control account
    const transaction = new TransactionBuilder(
      new Account(controlAccountRecord.id, controlAccountRecord.sequence),
      {
        fee: '10000',
        networkPassphrase: Networks[STELLAR_NETWORK],
      }
    ) // add the operation to add the new signer
      .addOperation(
        Operation.setOptions({
          signer: {
            ed25519PublicKey: newSignerKey,
            weight: removeSignerObj.weight,
          },
        })
      ) // add the operation to remove the old signer
      .addOperation(
        Operation.setOptions({
          signer: {
            ed25519PublicKey: removeSignerObj.key,
            weight: 0,
          },
        })
      ) // add the operation to add the new managedata entry
      .addOperation(
        Operation.manageData({
          name: `turret.${newSignerKey}`,
          value: newTurret,
        })
      )
      // add the operation to remove the old managedata entry
      .addOperation(
        Operation.manageData({
          name: `turret.${removeSignerObj.key}`,
          value: null,
        })
      )
      .setTimeout(5 * 60)
      .build();

    // generate the signature
    const { txFunctionSignerPublicKey, txFunctionSignerSecret } = metadata;

    const txFunctionSignerKeypair = Keypair.fromSecret(txFunctionSignerSecret);
    const txFunctionSignature = txFunctionSignerKeypair
      .sign(transaction.hash())
      .toString('base64');

    // return the info for the response
    return {
      xdr: transaction.toXDR(),
      signer: txFunctionSignerPublicKey,
      signature: txFunctionSignature,
    };
  } catch (err) {
    throw { status: 500, message: `heal failed, ${err}` };
  }
}

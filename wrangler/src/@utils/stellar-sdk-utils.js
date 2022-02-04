import BigNumber from 'bignumber.js';
import { Keypair, Networks, Transaction } from 'stellar-base';

/**
 * Verifies if a transaction was signed by the given account id.
 *
 * @function
 * @memberof Utils
 * @param {Transaction} transaction
 * @param {string} accountID
 * @example
 * let keypair = Keypair.random();
 * const account = new StellarSdk.Account(keypair.publicKey(), "-1");
 *
 * const transaction = new TransactionBuilder(account, { fee: 100 })
 *    .setTimeout(30)
 *    .build();
 *
 * transaction.sign(keypair)
 * Utils.verifyTxSignedBy(transaction, keypair.publicKey())
 * @returns {boolean}.
 */
export function verifyTxSignedBy(transaction, accountID) {
  return gatherTxSigners(transaction, [accountID]).length !== 0;
}

/**
 * Fetch an account from the public key
 *
 * @param {string} publicKey
 *
 * @returns {Promise<any>} Account record
 *
 * @link https://developers.stellar.org/api/resources/accounts/object/
 */
export async function loadAccount(publicKey) {
  try {
    const accountInfo = await fetch(`${HORIZON_URL}/accounts/${pubkey}`);
    return accountInfo.json();
  } catch {
    throw new Error(`Unable to fetch account with publicKey ${publicKey}`);
  }
}

/**
 *
 * gatherTxSigners checks if a transaction has been signed by one or more of
 * the given signers, returning a list of non-repeated signers that were found to have
 * signed the given transaction.
 *
 * @function
 * @memberof Utils
 * @param {Transaction} transaction the signed transaction.
 * @param {string[]} signers The signers public keys.
 * @example
 * let keypair1 = Keypair.random();
 * let keypair2 = Keypair.random();
 * const account = new StellarSdk.Account(keypair1.publicKey(), "-1");
 *
 * const transaction = new TransactionBuilder(account, { fee: 100 })
 *    .setTimeout(30)
 *    .build();
 *
 * transaction.sign(keypair1, keypair2)
 * Utils.gatherTxSigners(transaction, [keypair1.publicKey(), keypair2.publicKey()])
 * @returns {string[]} a list of signers that were found to have signed the transaction.
 */
export function gatherTxSigners(transaction, signers) {
  const hashedSignatureBase = transaction.hash();
  const signersFound = new Set();
  for (const signer of signers) {
    if (transaction.signatures.length === 0) {
      break;
    }
    let keypair;
    try {
      keypair = Keypair.fromPublicKey(signer); // This can throw a few different errors
    } catch (err) {
      throw new Error('Signer is not a valid address: ' + err.message);
    }
    for (let decSig of transaction.signatures) {
      if (!decSig.hint().equals(keypair.signatureHint())) {
        continue;
      }
      if (keypair.verify(hashedSignatureBase, decSig.signature())) {
        signersFound.add(signer);
        break;
      }
    }
  }
  return Array.from(signersFound);
}

/**
 * Process a fee payment made to the Turret
 *
 * @param {Object} env The current node env variables
 * @param {string} xdr The XDR of the fee payment to submit
 * @param {string | number} min The minimum fee payment amount
 * @param {string | number} max The maximum fee payment amount
 *
 * @typedef {Object} PaymentResult
 * @property {string} hash The resultant hash of the TX
 * @property {string} amount The amount payed
 *
 * @returns {PaymentResult} The result of the payment
 * @throws If the transaction is unable to be submitted for any reason
 */
export async function processFeePayment(env, xdr, min, max) {
  const { HORIZON_URL, STELLAR_NETWORK, TURRET_ADDRESS } = env;

  const transaction = new Transaction(xdr, Networks[STELLAR_NETWORK]);
  const transactionHash = transaction.hash().toString('hex');

  if (transaction.operations.length !== 1) {
    throw { message: `Fee payments cannot have more than one operation` };
  }

  const op = transaction.operations[0];
  if (
    op.type !== 'payment' ||
    op.destination !== TURRET_ADDRESS ||
    !op.asset.isNative()
  ) {
    throw {
      message: `Fee payments must be XLM payments made to ${TURRET_ADDRESS}`,
    };
  }

  if (min) {
    if (new BigNumber(op.amount).isLessThan(min)) {
      throw { message: `Fee payment too low. Min = ${min}` };
    }
  }

  if (max) {
    if (new BigNumber(op.amount).isGreaterThan(max)) {
      throw { message: `Fee payment too large. Max = ${max}` };
    }
  }

  let submissionCheckResult = await fetch(
    `${HORIZON_URL}/transactions/${transactionHash}`
  );
  if (submissionCheckResult.ok) {
    throw {
      message: `Fee payment with hash ${transactionHash} has already been submitted`,
    };
  } else if (submissionCheckResult.status === 404) {
    await processTransaction(HORIZON_URL, transaction);
    return {
      hash: transactionHash,
      amount: op.amount,
    };
  } else {
    throw { message: `Error checking for fee payment` };
  }
}

/**
 * Process a transaction
 *
 * @param {string} horizonUrl The Horizon endpoint to submit the tx to
 * @param {Transaction} transaction The transaction to submit
 *
 * @returns {string} The resultant transaction hash.
 * @throws If the transaction failed to submit
 */
async function processTransaction(horizonUrl, transaction) {
  const xdr = transaction.toXDR();
  const txBody = new FormData();
  txBody.append('tx', xdr);

  let txResult = await fetch(`${horizonUrl}/transactions`, {
    method: 'POST',
    body: txBody,
  });
  if (txResult.ok) {
    let txResultBody = await txResult.json();
    return txResultBody.hash;
  } else {
    throw { message: `Failed to submit transaction` };
  }
}

import { response } from 'cfw-easy-utils'
import shajs from 'sha.js'
import BigNumber from 'bignumber.js'
import { Keypair } from 'stellar-base'
import { processFeePayment } from '../@utils/stellar-sdk-utils'

export default async ({ request, env }) => {
  const { TX_FUNCTIONS, TURRET_ADDRESS, UPLOAD_DIVISOR, STELLAR_NETWORK, ALLOWED } = env
  const body = await request.formData()

  const txFunctionFields = body.get('txFunctionFields')
  const txFunctionFieldsBuffer = txFunctionFields ? Buffer.from(txFunctionFields, 'base64') : Buffer.alloc(0)

   // Test to ensure txFunctionFields is valid JSON on upload.
  if (txFunctionFields)
    if (!JSON.parse(txFunctionFieldsBuffer.toString())){
      throw 'json for txfunctionfields is not valid.'
    }

  const txFunction = body.get('txFunction')
  const txFunctionBuffer = Buffer.from(txFunction)

  const txFunctionConcat = Buffer.concat([txFunctionBuffer, txFunctionFieldsBuffer])
  const txFunctionHash = shajs('sha256').update(txFunctionConcat).digest('hex')

  const txFunctionExists = await TX_FUNCTIONS.get(txFunctionHash, 'arrayBuffer')

  if (txFunctionExists)
    throw `txFunction ${txFunctionHash} has already been uploaded to this turret`

  if (
    STELLAR_NETWORK === 'PUBLIC'
    && await ALLOWED.get(txFunctionHash) === null
  ) throw `txFunction ${txFunctionHash} is not allowed on this turret`

  const txFunctionSignerKeypair = Keypair.random()
  const txFunctionSignerSecret = txFunctionSignerKeypair.secret()
  const txFunctionSignerPublicKey = txFunctionSignerKeypair.publicKey()

  const cost = new BigNumber(txFunctionConcat.length).dividedBy(UPLOAD_DIVISOR).toFixed(7)

  let transactionHash

  try {
    const txFunctionFee = body.get('txFunctionFee')

    // throws if payment fails, if the fee is invalid, if the fee is too large or too small. Fixes STRI 4
    await processFeePayment(env, txFunctionFee, cost, cost);

  } catch (err) {
    return response.json({
      message: typeof err.message === 'string' ? err.message : 'Failed to process txFunctionFee',
      status: 402,
      turret: TURRET_ADDRESS,
      cost,
    }, {
      status: 402
    })
  }

  await TX_FUNCTIONS.put(txFunctionHash, txFunctionConcat, {metadata: {
    cost,
    payment: transactionHash,
    length: txFunctionBuffer.length,
    txFunctionSignerSecret,
    txFunctionSignerPublicKey,
  }})

  return response.json({
    hash: txFunctionHash,
    signer: txFunctionSignerPublicKey,
  })
}
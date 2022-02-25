import { response } from 'cfw-easy-utils';
import { StrKey } from 'stellar-base';
import { heal } from '../@utils/trust';

export default async ({ request, env }) => {
  const {
    controlAccountId,
    removeTurretAccountId,
    newTurretAccountId,
    txFunctionHash,
    timestamp,
    userAccountId,
    fee,
  } = await request.json();

  // light input parsing
  // validate the event timestamp was recent - cap at 5 minutes
  if (timestamp > Date.now() - 5 * 60 * 1000) {
    throw {
      status: 400,
      message: 'The heal event timestamp was over 5 minutes ago',
    };
  }

  // validate public keys are actually public keys
  if (
    !StrKey.isValidEd25519PublicKey(controlAccountId) ||
    !StrKey.isValidEd25519PublicKey(removeTurretAccountId) ||
    !StrKey.isValidEd25519PublicKey(newTurretAccountId) ||
    !StrKey.isValidEd25519PublicKey(userAccountId)
  ) {
    throw {
      status: 400,
      message: 'Please use a valid ed25519 public key for all accountIds.',
    };
  }

  // validate the fee is something believable
  if (fee < 100 || fee > 10000000) {
    throw {
      status: 400,
      message: 'Please enter a valid fee in stroops between 100 and 10,000,000',
    };
  }

  const healResponse = await heal(
    controlAccountId,
    removeTurretAccountId,
    newTurretAccountId,
    txFunctionHash,
    timestamp,
    userAccountId,
    fee,
    env
  );
  
  return response.json(healResponse);
};

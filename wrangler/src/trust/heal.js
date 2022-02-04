import { response } from 'cfw-easy-utils'
import { heal } from 'trust.js'

export default async ({ request, env }) => {
  const { TX_FUNCTIONS, TURRET_ADDRESS, STELLAR_NETWORK, HORIZON_URL } = env
  const { 
    sourceaccount,
    oldturret,
    newturret,
    functionhash 
  } = await request.json()
  
  const healresponse = await heal(sourceaccount, oldturret, newturret, functionhash)
  return response.json(healresponse)
}
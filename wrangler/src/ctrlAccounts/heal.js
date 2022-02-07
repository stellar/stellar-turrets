import { response } from 'cfw-easy-utils'
import { heal } from '../@utils/trust'

export default async ({ request, env }) => {
  const {
    sourceaccount,
    oldturret,
    newturret,
    functionhash
  } = await request.json()

  const healresponse = await heal(sourceaccount, oldturret, newturret, functionhash)
  return response.json(healresponse)
}
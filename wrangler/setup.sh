npx wrangler kv:key put --binding=META "STELLAR_TOML" ./stellar.toml --path
printf "\n"
npx wrangler kv:namespace create "META"
printf "\n\n"
npx wrangler kv:namespace create "TX_FUNCTIONS"
printf "\n\n"
npx wrangler secret put TURRET_SIGNER
printf "\n\n"
npx wrangler kv:key put --binding=META "STELLAR_TOML" ./stellar.toml --path --env public
printf "\n"
npx wrangler kv:namespace create "META" --env public
printf "\n\n"
npx wrangler kv:namespace create "TX_FUNCTIONS" --env public
printf "\n\n"
npx wrangler kv:namespace create "ALLOWED" --env public
printf "\n\n"
npx wrangler secret put TURRET_SIGNER --env public
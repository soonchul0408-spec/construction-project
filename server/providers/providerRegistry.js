const providerEnvKeys = {
  localFinanceContract: ['LOFIN_CONTRACT_API_URL', 'LOFIN_CONTRACT_API_KEY'],
  assemblyBill: ['ASSEMBLY_BILL_API_URL', 'ASSEMBLY_BILL_API_KEY'],
  dart: ['DART_API_KEY'],
}

export function getProviderStatus() {
  return Object.fromEntries(
    Object.entries(providerEnvKeys).map(([provider, envKeys]) => [
      provider,
      {
        configured: envKeys.every((envKey) => Boolean(process.env[envKey])),
      },
    ]),
  )
}

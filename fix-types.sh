#!/bin/bash

# Fix index.ts errors

# Fix currency_code -> iso_code
sed -i 's/currency_format?.currency_code/currency_format?.iso_code/g' src/tools/reconciliation/index.ts

# Fix exact optional property types in index.ts
# The csvFormat can be undefined, so we need to handle that properly

# Fix coerceString calls to handle null properly
sed -i "s/coerceString(format.thousands_separator ?? null, null)/coerceString(format.thousands_separator ?? null, '')/g" src/tools/reconciliation/index.ts
sed -i "s/coerceString(format.date_column ?? null, null)/coerceString(format.date_column ?? null, '')/g" src/tools/reconciliation/index.ts
sed -i "s/coerceString(format.amount_column ?? null, null)/coerceString(format.amount_column ?? null, '')/g" src/tools/reconciliation/index.ts
sed -i "s/coerceString(format.description_column ?? null, null)/coerceString(format.description_column ?? null, '')/g" src/tools/reconciliation/index.ts

echo "Type fixes applied"

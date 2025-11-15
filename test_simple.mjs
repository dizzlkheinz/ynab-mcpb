// Simplified test to debug the issue
const mockResponse = {
  data: {
    transaction: {
      id: 'new-transaction-123',
      date: '2024-01-01',
      amount: -50000,
      account_id: 'account-456',
    },
    server_knowledge: 1,
  },
};

console.log('Mock response:', JSON.stringify(mockResponse, null, 2));
console.log('Transaction:', mockResponse.data.transaction);
console.log('Server knowledge:', mockResponse.data.server_knowledge);

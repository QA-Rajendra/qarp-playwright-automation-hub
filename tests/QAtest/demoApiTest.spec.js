const { test, expect } = require('@playwright/test');

test.describe('Demo API Testing Suite', () => {
  test('GET Request - Fetch Post Details', async ({ request }) => {
    const res = await request.get('https://jsonplaceholder.typicode.com/posts/1');
    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(1);
  });

  test('POST Request - Create New Post', async ({ request }) => {
    const res = await request.post('https://jsonplaceholder.typicode.com/posts', {
      data: {
        title: 'QARP Automation Hub API Test',
        body: 'Testing automatic API request & response capture',
        userId: 42
      },
      headers: {
        'Content-Type': 'application/json; charset=UTF-8'
      }
    });
    expect(res.status()).toBe(201);
    const data = await res.json();
    expect(data.title).toBe('QARP Automation Hub API Test');
  });
});

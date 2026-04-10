const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || 'https://your-backend-url.render.com';

// Example API call function
async function fetchData(endpoint) {
    const response = await fetch(`${API_BASE_URL}/${endpoint}`);
    if (!response.ok) {
        throw new Error('Network response was not ok');
    }
    return await response.json();
}

// Replace localStorage references with API calls where possible
// Example:
// const paymentData = await fetchData('payments');

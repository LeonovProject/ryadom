window.addEventListener('load', () => {
  window.ui = SwaggerUIBundle({
    url: '/api/openapi.yaml',
    dom_id: '#swagger-ui',
    validatorUrl: null,
    supportedSubmitMethods: [],
    persistAuthorization: false,
    withCredentials: false,
    deepLinking: true,
    presets: [SwaggerUIBundle.presets.apis],
  });
});

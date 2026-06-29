// netlify/functions/crear-preferencia.js
// Esta función corre en el servidor de Netlify — las credenciales NUNCA llegan al navegador.

exports.handler = async (event) => {
  // Solo aceptar POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Método no permitido' }) };
  }

  // Leer el Access Token desde variables de entorno de Netlify (nunca desde el código)
  const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
  if (!ACCESS_TOKEN) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Credenciales no configuradas' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  const { plan, nombre, apellido, email } = body;

  // Definición de planes
  const planes = {
    individual:    { titulo: 'Plan Lite · BitacoraApp',    precio: 4990  },
    institucional: { titulo: 'Plan Full · BitacoraApp', precio: 15990 }
  };

  const planData = planes[plan];
  if (!planData) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Plan no válido' }) };
  }

  // Construir preferencia de pago
  const preferencia = {
    items: [{
      title: planData.titulo,
      quantity: 1,
      currency_id: 'CLP',
      unit_price: planData.precio
    }],
    payer: {
      name: nombre || '',
      surname: apellido || '',
      email: email || ''
    },
    back_urls: {
      success: `${event.headers.origin || ''}/Pagos.html?estado=success`,
      failure: `${event.headers.origin || ''}/Pagos.html?estado=failure`,
      pending: `${event.headers.origin || ''}/Pagos.html?estado=pending`
    },
    auto_return: 'approved',
    external_reference: 'BIT-' + Date.now(),
    statement_descriptor: 'BITACORAAPP'
  };

  // Llamar a la API de Mercado Pago desde el servidor
  try {
    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ACCESS_TOKEN}`
      },
      body: JSON.stringify(preferencia)
    });

    const mpData = await mpRes.json();

    if (!mpRes.ok || !mpData.init_point) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Error en Mercado Pago', detalle: mpData })
      };
    }

    // Solo devolver el link de pago — el Access Token nunca sale del servidor
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        init_point: mpData.init_point,
        external_reference: mpData.external_reference
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Error interno', detalle: err.message })
    };
  }
};

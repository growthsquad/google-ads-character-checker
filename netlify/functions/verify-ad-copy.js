exports.handler = async (event, context) => {
  // Enable CORS for cross-origin requests
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  };

  // Handle preflight OPTIONS request
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    let platform, items;

    // Handle both GET and POST requests
    if (event.httpMethod === "GET") {
      // Parse query parameters for GET request
      const params = event.queryStringParameters || {};
      
      // Support simple single-item verification via GET
      if (params.text && params.type) {
        platform = params.platform || "google_ads";
        items = [{
          text: params.text,
          type: params.type
        }];
      }
      // Support multiple items via JSON in query parameter
      else if (params.data) {
        try {
          const data = JSON.parse(decodeURIComponent(params.data));
          platform = data.platform;
          items = data.items;
        } catch (e) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
              error: "Invalid JSON in data parameter",
              usage: {
                simple: "?text=Your+Headline&type=headline&platform=google_ads",
                complex: "?data=" + encodeURIComponent(JSON.stringify({
                  platform: "google_ads",
                  items: [
                    {text: "Your Headline", type: "headline"}
                  ]
                }))
              }
            })
          };
        }
      }
      // Return usage instructions if no valid parameters
      else {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            message: "Character Verification API",
            version: "2.0",
            methods: ["GET", "POST"],
            usage: {
              get_simple: {
                url: "?text=Your+Headline+Here&type=headline&platform=google_ads",
                description: "Verify a single piece of ad copy"
              },
              get_complex: {
                url: "?data=" + encodeURIComponent(JSON.stringify({
                  platform: "google_ads",
                  items: [
                    {text: "Headline 1", type: "headline"},
                    {text: "Description text", type: "description"}
                  ]
                })),
                description: "Verify multiple items (URL encode the JSON)"
              },
              post: {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: {
                  platform: "google_ads",
                  items: [
                    {text: "Your ad copy", type: "headline"}
                  ]
                }
              }
            },
            platforms: ["google_ads", "facebook_ads", "linkedin_ads"],
            limits: {
              google_ads: {
                headline: 30,
                description: 90,
                callout: 25,
                path: 15
              }
            }
          })
        };
      }
    } 
    else if (event.httpMethod === "POST") {
      // Handle POST request (existing functionality)
      const body = JSON.parse(event.body || "{}");
      platform = body.platform;
      items = body.items;
    }
    else {
      return {
        statusCode: 405,
        headers,
        body: JSON.stringify({ error: "Method not allowed. Use GET or POST." })
      };
    }

    // Validate input
    if (!platform || !items || !Array.isArray(items)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: "Invalid request. Expected: platform and items array",
          received: { platform, items: Array.isArray(items) ? `array[${items.length}]` : typeof items }
        })
      };
    }

    // Character limits by platform and ad type
    const limits = {
      google_ads: {
        headline: 30,
        description: 90,
        callout: 25,
        path: 15,
        sitelink_text: 25,
        sitelink_desc: 35,
        structured_snippet: 25
      },
      facebook_ads: {
        headline: 40,
        description: 125,
        link_description: 30
      },
      linkedin_ads: {
        headline: 150,
        description: 600,
        intro_text: 150
      }
    };

    // Check if platform exists
    if (!limits[platform]) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: `Unsupported platform: ${platform}`,
          supported: Object.keys(limits)
        })
      };
    }

    // Verify each text item
    const results = items.map((item, index) => {
      // Validate item structure
      if (!item.text || !item.type) {
        return {
          index,
          error: "Item missing 'text' or 'type' field",
          text: item.text || "",
          type: item.type || "unknown"
        };
      }

      // Count characters (actual length)
      const characterCount = item.text.length;
      const characterLimit = limits[platform][item.type];
      
      // Check if type is supported for this platform
      if (characterLimit === undefined) {
        return {
          index,
          text: item.text,
          type: item.type,
          character_count: characterCount,
          error: `Unsupported type '${item.type}' for platform '${platform}'`,
          supported_types: Object.keys(limits[platform])
        };
      }

      const isValid = characterCount <= characterLimit;
      const overage = isValid ? 0 : characterCount - characterLimit;
      
      return {
        index,
        text: item.text,
        type: item.type,
        character_count: characterCount,
        character_limit: characterLimit,
        is_valid: isValid,
        status: isValid ? "✓" : "✗",
        overage: overage,
        ...(overage > 0 && {
          recommendation: `Reduce by ${overage} character${overage > 1 ? 's' : ''}`
        })
      };
    });

    // Calculate summary statistics
    const validResults = results.filter(r => !r.error);
    const validItems = validResults.filter(r => r.is_valid);
    const invalidItems = validResults.filter(r => !r.is_valid);
    const errorItems = results.filter(r => r.error);

    // Prepare response
    const response = {
      platform,
      method: event.httpMethod,
      timestamp: new Date().toISOString(),
      summary: {
        total_items: results.length,
        valid_items: validItems.length,
        invalid_items: invalidItems.length,
        error_items: errorItems.length,
        all_valid: invalidItems.length === 0 && errorItems.length === 0
      },
      results,
      ...(invalidItems.length > 0 && {
        violations: invalidItems.map(item => ({
          text: item.text,
          type: item.type,
          overage: item.overage,
          recommendation: item.recommendation
        }))
      })
    };

    return {
      statusCode: 200,
      headers: {
        ...headers,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(response, null, 2)
    };

  } catch (error) {
    console.error("API Error:", error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: "Internal server error",
        message: error.message 
      })
    };
  }
};

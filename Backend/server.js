const dotenv = require("dotenv").config();
const express = require("express");
const cors = require("cors");


const app = express();
const generator = require('generate-password');



// populates key variables from the dotenv file
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const tenantId = process.env.TENANT_ID;
const verifiedEmails = process.env.VERIFIED_EMAILS ? process.env.VERIFIED_EMAILS.split(",") : [];
const domain = process.env.DOMAIN;
const apiKey = process.env.API_KEY;




const Database = require("better-sqlite3");
const db = new Database("rolegroups.db");

app.use(express.json());
app.use(cors({
  origin: ["http://127.0.0.1:5500", "http://localhost:5500"],// insert any frontend urls 
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// Initialises the database, also adds an ALL role to the roles table, this should be assigned any group meant for every user.
db.exec(`
  CREATE TABLE IF NOT EXISTS roles (
    role_id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_name TEXT UNIQUE
  );
  CREATE TABLE IF NOT EXISTS groups (
    group_id TEXT PRIMARY KEY,
    group_name TEXT
  );§
  CREATE TABLE IF NOT EXISTS roles_groups (
    role_id INTEGER,
    group_id TEXT,
    PRIMARY KEY (role_id, group_id),
    FOREIGN KEY (role_id) REFERENCES roles(role_id) ON DELETE CASCADE,
    FOREIGN KEY (group_id) REFERENCES groups(group_id) ON DELETE CASCADE
  );
  
  INSERT OR IGNORE INTO roles (role_name) VALUES ('ALL')
`);


// function to check if the user making an api call is a verified user 
async function verifyToken(req, res, next) {
  // retrieves the token of the logged in user from the call
  const authHeader = req.headers["authorization"];
  // rejects if empty header
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  const token = authHeader.split(" ")[1];

  try {

    const base64Payload = token.split(".")[1];
    const payload = JSON.parse(Buffer.from(base64Payload, "base64").toString("utf8"));
    
    const userEmail = payload.upn || payload.preferred_username || payload.email;
    if (!userEmail) {
      return res.status(403).json({ error: "Token does not contain a valid email" });
    }

    // Check against verified emails from .env
    if (!verifiedEmails.includes(userEmail.toLowerCase())) {
      return res.status(403).json({ error: "Email not authorized" });
    }

    req.user = { email: userEmail, tokenPayload: payload };
    next();
  } catch (err) {
    console.error("Token verification error:", err);
    return res.status(500).json({ error: "Token verification failed" });
  }
}

// function to automatically retrieve an entra access token
async function getAccessToken() {
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const params = new URLSearchParams();
  params.append("client_id", clientId);
  params.append("client_secret", clientSecret);
  params.append("scope", "https://graph.microsoft.com/.default");
  params.append("grant_type", "client_credentials");

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });

  const data = await response.json();
  if (!data.access_token) throw new Error("Failed to obtain access token");
  return data.access_token;
}


async function getUserByEmail(email) {
  const token = await getAccessToken();
  const url = `https://graph.microsoft.com/v1.0/users?$filter=userPrincipalName eq '${email}'`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  
  if (!res.ok) {
    const errorText = await res.text();
    }
  
  const data = await res.json();
  return data.value.length > 0 ? data.value[0] : null;
}


// Checks to see if the email from the submitted ticket already exists 
async function emailExists(email) {
  const user = await getUserByEmail(email);
  return user !== null;
}


// retrieves the data of a group when provided the id from the database
async function getGroupById(groupId) {
  const token = await getAccessToken();
  const url = `https://graph.microsoft.com/v1.0/groups/${groupId}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  
  if (!res.ok) {
    if (res.status === 404) {
      console.error(`Group ${groupId} not found`);
      return null;
    }
    const errorText = await res.text();
    throw new Error(`Graph API error: ${res.status} - ${errorText}`);
  }
  
  return await res.json();
}

// checks if user is already in the group, to not repeat being added to it 
async function isUserInGroup(userId, groupId) {
  const token = await getAccessToken();
  const url = `https://graph.microsoft.com/v1.0/groups/${groupId}/members/${userId}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  // if the user is in the group return status 200
  if (res.status === 200) return true;
  // if the user is not in the group return status 400
  if (res.status === 404) return false;
  
  const errorText = await res.text();
  throw new Error(`Error checking group membership: ${res.status} - ${errorText}`);
}

// function to create the user 
async function createUserGraph(userData) {
  const token = await getAccessToken();
  // sends a create request to the api, submitting the user data, and the access token
  const response = await fetch("https://graph.microsoft.com/v1.0/users", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(userData)
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Graph API error: ${response.status} - ${errorText}`);
  }
  
  return response.json();
}

// Function to add the user to the group
async function addUserToGroup(userId, groupId) {
  const token = await getAccessToken();
  
  // gets the group info from the submitted id
  const group = await getGroupById(groupId);
  if (!group) {
    throw new Error(`Group ${groupId} does not exist`);
  }

  
  const alreadyMember = await isUserInGroup(userId, groupId);
  if (alreadyMember) {
    
    return { success: true, message: "User already in group" };
  }
  
  // API call with the user id as a body, adds the user to the group
  const response = await fetch(`https://graph.microsoft.com/v1.0/groups/${groupId}/members/$ref`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      "@odata.id": `https://graph.microsoft.com/v1.0/directoryObjects/${userId}`
    })
  });
  // if the group add is unsuccesful outputs error 
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Failed to add user to group ${groupId}: ${response.status} - ${errorText}`);
    
    throw new Error(`Failed to add user to group ${groupId}: ${response.status} - ${errorDetails}`);
  } else {
    console.log(`Successfully added user ${userId} to group ${group.displayName} (${groupId})`);
    return { success: true, message: "User added to group successfully" };
  }
}


// Calls the database to retrieve any role group entries that contain the roles name 
function getGroupsForRole(roleName) {
  const stmt = db.prepare(`
    SELECT g.group_id, g.group_name
    FROM roles r
    JOIN roles_groups rg ON r.role_id = rg.role_id
    JOIN groups g ON rg.group_id = g.group_id
    WHERE TRIM(r.role_name) = ?
  `);
  const rows = stmt.all(roleName.trim());

  return rows;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// function that pulls all the groups from graph and if it is not already in the database they are added 
async function seedGroups() {
  try {
    const token = await getAccessToken();
    const response = await fetch("https://graph.microsoft.com/v1.0/groups", {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Graph API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
   
    const insert = db.prepare(`INSERT OR IGNORE INTO groups (group_id, group_name) VALUES (?, ?)`);

    for (const group of data.value) {
      insert.run(group.id, group.displayName);
    }

  
  } catch (err) {
    console.error("Error seeding groups:", err);
    throw err;
  }
}

// API endpoint to create user, 
app.post("/api/createUser", verifyToken, async (req, res) => {
  try {
    // retrieves the ticket data from the request body
    const { email, displayName, jobTitle, department, roles } = req.body;

    if (!email || !displayName) {
      return res.status(400).json({ success: false, message: "Email and displayName are required" });
    }


    let roleArray = [];
    if (typeof roles === "string") roleArray = [roles];
    else if (Array.isArray(roles)) roleArray = roles;

   



    if (await emailExists(email)) {
      return res.json({ userExists: true });
    }
    // creates a password for the user 
    const password = generator.generate({
      length: 15,
      numbers: true,
      symbols: true,
      uppercase: true,
      lowercase: true,
      strict: true
    });
    

    const firstPart = email.split("@")[0].replace(/[^a-zA-Z0-9]/g, "");
    const newUserData = {
      accountEnabled: true,
      displayName,
      mailNickname: firstPart,
      userPrincipalName: email,
      jobTitle: jobTitle || "",
      department: department || "",
      passwordProfile: {
        forceChangePasswordNextSignIn: true,
        password: password
      }
    };
    // outputs the users password to console
    console.log(`user created with password: ${password}`)

    

    const createdUser = await createUserGraph(newUserData);
    console.log("Created user:", createdUser);


    // Delay prevents any issues with not being properly added to group
    await delay(3000); 

    // Creates a fresh array to store the assigned groups based on the ticket data
    const groupAssignmentResults = [];


    // Loops through all the passed strings in the roles array, and checks the database for any rolegroup entries
    for (let roleName of roleArray) {
      roleName = roleName.trim();
      const roleGroups = getGroupsForRole(roleName);
      
      if (roleGroups.length === 0) {
        console.warn(`No groups found for role "${roleName}"`);
        groupAssignmentResults.push({
          role: roleName,
          success: false,
          message: `No groups configured for role "${roleName}"`
        });
        continue;
      }
      
      // Loops through the array of associated groups 
      for (const roleGroup of roleGroups) {
        let success = false;
        let lastError = null;
        
        // Attempts to add the user to the group 3 times, to increase the chance of it being succesful
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const result = await addUserToGroup(createdUser.id, roleGroup.group_id);
          
            groupAssignmentResults.push({
              role: roleName,
              group: roleGroup.group_name,
              groupId: roleGroup.group_id,
              success: true,
              attempt: attempt
            });
            success = true;
            break;
          } catch (err) {
            lastError = err;
            
            console.error(`Attempt ${attempt} failed to add user to group ${roleGroup.group_name}: ${err.message}`);
            
            if (attempt < 3) {
     
              await delay(2000);
            }
          }
        }
        
        if (!success) {
          console.error(`Failed to add user ${createdUser.id} to group ${roleGroup.group_name} after 3 attempts`);
          groupAssignmentResults.push({
            role: roleName,
            group: roleGroup.group_name,
            groupId: roleGroup.group_id,
            success: false,
            error: lastError ? lastError.message : "Unknown error",
            attempts: 3
          });
        }
      }
    }
    // returns user data, and the password they were given
    res.json({ 
      userExists: false, 
      createdUser,
      groupAssignments: groupAssignmentResults,
      password
    
    });

  } catch (err) {
    console.error("Create user error:", err);
    res.status(500).json({ 
      success: false, 
      error: err.message, 
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});


// API endpoint to retrieve the freshservice api ticket 
app.get("/api/tickets/:id", verifyToken, async (req, res) => {
  const ticketId = req.params.id;
  if (!domain || !apiKey) return res.status(500).json({ error: "" });

  const url = `https://${domain}/api/v2/tickets/${ticketId}?include=onboarding_context`;
  const headers = {
    "Authorization": "Basic " + Buffer.from(apiKey + ":X").toString("base64"),
    "Content-Type": "application/json",
  };

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: text });
    }
    const data = await response.json();
    const ticket = data.ticket;
    const fields = ticket?.onboarding_context?.fields || {};
    res.json({ ticket, fields });
  } catch (err) {
    console.error("Error fetching ticket:", err);
    res.status(500).json({ error: err.message });
  }
});

// API endpoint to add a role to the database
app.post("/api/roles", (req, res) => {
  const { role_name } = req.body;
  db.prepare("INSERT OR IGNORE INTO roles (role_name) VALUES (?)").run(role_name);
  res.json({ success: true });
});

// API endpoint to delete the role from the database
app.delete("/api/roles/:roleName", (req, res) => {
  const { roleName } = req.params;
  db.prepare("DELETE FROM roles WHERE role_name = ?").run(roleName);
  res.json({ success: true });
});


// API endpoint that returns all the roles and groups from the database, as well as all the relations from the roles-groups table
app.get("/api/roles-groups", (req, res) => {
  seedGroups();
  const roles = db.prepare("SELECT * FROM roles").all();
  const roleGroups = db.prepare("SELECT * FROM roles_groups").all();
  const groups = db.prepare("SELECT * FROM groups").all();
  res.json({ roles, groups, roleGroups });
});r

// Endpoint to create a role-group relation
app.post("/api/roles-groups", (req, res) => {
  const { roleId, groupId } = req.body;
  if (!roleId || !groupId) return res.status(400).json({ success: false });
  db.prepare("INSERT OR IGNORE INTO roles_groups (role_id, group_id) VALUES (?, ?)").run(Number(roleId), groupId);
  res.json({ success: true });
});

// Endpoint to delete a role-group relation
app.delete("/api/roles-groups", (req, res) => {
  const { roleId, groupId } = req.body;
  if (!roleId || !groupId) return res.status(400).json({ success: false });
  db.prepare("DELETE FROM roles_groups WHERE role_id = ? AND group_id = ?").run(Number(roleId), groupId);
  res.json({ success: true });
});


// Endpoint to reload and update database
app.get("/api/database", async (req, res) => {
  try {
    await seedGroups();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST Endpoint to return all the groups assigned to a user based on a ticket
app.post("/api/previewGroups", verifyToken, async (req, res) => {
  try {
    const roles = req.body.roles;

    

    const groupPreview = [];

    for (let roleName of roles) {
      // Loops through every role submitted from the ticket, and runs the getGRoupsForRole function to get all the valid grouos
      const roleGroups = getGroupsForRole(roleName.trim());
      // pushes the returned groups onto the array, if there are none it returns a message saying there are none
      groupPreview.push({
        role: roleName,
        groups: roleGroups.map(g => g.group_name),
        message: roleGroups.length === 0 ? `No groups configured for role "${roleName}"` : ""
      });
    }
    // Returns a sucess code, along with all the groups 
    res.json({ success: true, groupPreview });
  } catch (err) {
    console.error("PreviewGroups error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// port the server is being ran on
const PORT = 5001;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  try {
    await seedGroups();
   
  } catch (err) {
    console.error("Error seeding groups at startup:", err);
  }
});
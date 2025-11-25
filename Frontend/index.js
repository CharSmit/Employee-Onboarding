
const apiReturn = document.querySelector(".apiReturn");
const inputElement = document.getElementById("ticketInput");

const tenantDomain = "CharlieSSmithoutlook.onmicrosoft.com";
const msalConfig = {
  auth: {
    clientId: "5189a8ce-378f-4ef4-ac58-5d7b4fe25fdb",
    authority: "https://login.microsoftonline.com/a40e5e14-500d-4e6d-b1e5-f1a463310856",
    redirectUri: "http://localhost:5500"
  }
};
// Add the domain of the server
domain = 'http://localhost:5001'

const msalInstance = new msal.PublicClientApplication(msalConfig);
let account = null;
let accessToken = null;


async function signIn() {
  try {
    const loginResponse = await msalInstance.loginPopup({
      scopes: ["User.Read"],
    });

    account = loginResponse.account;


    const tokenResponse = await msalInstance.acquireTokenSilent({
      scopes: ["User.Read"],
      account: account,
    });

    accessToken = tokenResponse.accessToken;
    

    alert(`Logged in as ${account.username}`);
  } catch (err) {
    console.error("Login failed:", err);

  }
}

// function to retrieve the freshservice ticket
async function pullTicket() {
  if (!accessToken) {
    alert("Please login first with Microsoft.");
    return;
  }

  const ticketId = inputElement.value.trim();
  if (!ticketId) {
    alert("Please enter a ticket ID.");
    return;
  }

  try {
    // retrieves the ticket data for the supplied ticket number
    const res = await fetch(`${domain}/api/tickets/${ticketId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const data = await res.json();
    // checks if the returned ticket has any onboarding context and outputs it
    if (data.ticket?.onboarding_context?.fields) {
      const fields = data.ticket.onboarding_context.fields;
      apiReturn.innerHTML = `
        <p><strong>Name:</strong> ${fields.cf_employee_name} ${fields.cf_surname}</p>
        <p><strong>Email:</strong> ${fields.cf_suggested_email_address}</p>
        <p><strong>Job Title:</strong> ${fields.cf_job_title}</p>
        <p><strong>Department:</strong> ${fields.cf_departments}</p>
        <p><strong>Device:</strong> ${fields.cf_device}</p>
        <p><strong>Line Manager:</strong> ${fields.cf_line_manager}</p>
        <button id="proceedBtn">Proceed to Account Creation</button>
      `;
      document
        .getElementById("proceedBtn")
        .addEventListener("click", () => SubmitTicket(fields));
    } else {
      apiReturn.innerHTML =
        "The entered ticket number is not a valid onboarding ticket.";
    }
  } catch (err) {
    console.error(err);
    apiReturn.innerHTML = "Error fetching ticket";
  }
}



async function SubmitTicket(fields) {
  const firstName = fields.cf_employee_name.toLowerCase().replace(/\s+/g, "");
  const lastName = fields.cf_surname.toLowerCase().replace(/\s+/g, "");
  const tenantEmail = `${firstName}.${lastName}@${tenantDomain}`;

  apiReturn.innerHTML = `
    <form id="createUserForm">
      <p>Name: ${fields.cf_employee_name} ${fields.cf_surname}</p>
      <p>Email: <input type="email" id="userEmail" value="${tenantEmail}" /></p>
      <p>Job Title: <input type="text" id="jobTitle" value="${fields.cf_job_title}" /></p>
      <p>Department: <input type="text" id="department" value="${fields.cf_departments}" /></p>
      <button type="button" id="checkCreateBtn">Check & Preview Groups</button>
    </form>
    <div id="result"></div>
  `;

  const checkBtn = document.getElementById("checkCreateBtn");
  // if the user is not logged in does not let them proceed
  checkBtn.addEventListener("click", async () => {
    if (!accessToken) {
      alert("Please login first with Microsoft.");
      return;
    }

    const emailInput = document.getElementById("userEmail").value;
    const jobTitleInput = document.getElementById("jobTitle").value;
    const departmentInput = document.getElementById("department").value;
    const resultDiv = document.getElementById("result");
    // These inputs dictate what sections are counted as roles for the database logic 
    const roles = [departmentInput, jobTitleInput, fields.cf_line_manager, "ALL"];

    resultDiv.innerHTML = "Fetching group preview...";

    try {
      // api call to retrieve groups that will be assigned to the user
      const previewRes = await fetch(`${domain}/api/previewGroups`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ roles }),
      });

      const previewData = await previewRes.json();

      if (!previewData.success) {
        resultDiv.innerHTML = "Failed to fetch group preview.";
        return;
      }

      // displays all the groups the created user is going to be added to 
      let html = "<h4>Groups user will be added to:</h4><ul>";
      previewData.groupPreview.forEach(roleEntry => {
        html += `<li>${roleEntry.role}: ${roleEntry.groups.length > 0 ? roleEntry.groups.join(", ") : roleEntry.message}</li>`;
      });
      html += "</ul>";
      html += `<button id="createUserBtn">Create User</button>`;

      resultDiv.innerHTML = html;

      
      document.getElementById("createUserBtn").addEventListener("click", async () => {
        resultDiv.innerHTML = "Creating user...";
        try {
          // calls the api to create the user
          const createRes = await fetch(`${domain}/api/createUser`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            // submits the data for the employee, pre populates outlook profile
            body: JSON.stringify({
              email: emailInput,
              displayName: `${fields.cf_employee_name} ${fields.cf_surname}`,
              jobTitle: jobTitleInput,
              department: departmentInput,
              roles,
            }),
          });

          const createData = await createRes.json();

          if (createData.userExists) {
            resultDiv.innerHTML = `User already exists: ${emailInput}`;
          } else if (createData.createdUser) {
            // outputs the user name, and the password they were randomly given
            resultDiv.innerHTML = `User created successfully: ${createData.createdUser.userPrincipalName} with password ${createData.password}`;
          } else {
            resultDiv.innerHTML = "No user creation occurred.";
          }
        } catch (err) {
          resultDiv.innerHTML = "Error: " + err.message;
        }
      });
    } catch (err) {
      resultDiv.innerHTML = "Error fetching preview: " + err.message;
    }
  });
}
document.getElementById("loginBtn").addEventListener("click", signIn);
document.getElementById("ticketBtn").addEventListener("click", pullTicket);

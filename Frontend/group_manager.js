const outputElement = document.querySelector('.role-group-output');
const createRoleBtn = document.getElementById('create-role-button');

createRoleBtn.addEventListener("click", createRole);
reloadDatabaseButton = document.getElementById('reload-database-button')
reloadDatabaseButton.addEventListener('click', reloadDatabase)



// Insert the domain the server is being hosted on
domain = 'http://localhost:5001'
loadData();
async function reloadDatabase() {
  const res = await fetch(`${domain}/api/roles-groups`)
  loadData();
}
async function loadData() {
    try {
      // pulls the role-group data from the database
      const res = await fetch(`${domain}/api/roles-groups`);
      const data = await res.json();
      const { roles, groups, roleGroups } = data;
  
      outputElement.innerHTML = "<h3>Roles</h3><ul></ul>";
      const ul = outputElement.querySelector("ul");
  
      roles.forEach(role => {
        const li = document.createElement("li");
  
        
        const roleNameSpan = document.createElement("span");
        roleNameSpan.textContent = role.role_name + " ";
        li.appendChild(roleNameSpan);
  
        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "Delete";
        deleteBtn.addEventListener("click", async () => {
          await deleteRole(role.role_name);
        });
        li.appendChild(deleteBtn);
  
      
        const container = document.createElement("div");
        container.id = `role-${role.role_id}-groups`;
  
        
        groups.forEach(group => {
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          // if there is an existing connection between the role and the group, the box is ticked
          checkbox.checked = roleGroups.some(
            rg => rg.role_id === role.role_id && rg.group_id === group.group_id
          );
  
          checkbox.addEventListener("change", async (e) => {
            const payload = { roleId: Number(role.role_id), groupId: group.group_id };
            console.log(payload)
            // if the box is ticked, calls the api with a post request, containing the groupid and roleid to create a relation between the 2 in the database, if it is not checked makes a delete request and deletes that relation
            if (e.target.checked) {
              await fetch(`${domain}/api/roles-groups`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
              });
            } else {
              await fetch(`${domain}/api/roles-groups`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
              });
            }
          });
  
          const label = document.createElement("label");
          label.appendChild(checkbox);
          label.appendChild(document.createTextNode(group.group_name));
          container.appendChild(label);
        });
  
        li.appendChild(container);
        ul.appendChild(li);
      });
  
    } catch (err) {
      outputElement.innerHTML = "Error loading data: " + err.message;
    }
  }
  

async function toggleRoleGroup(roleId, groupId, checked) {
  const payload = { roleId: Number(roleId), groupId: Number(groupId) };
  // Makes a call to the api depending on if the box interacted with was ticked or not, if it was ticked it makes a post call to create a new instance, if not it makes a delete call to delete the existing relationshio
  await fetch(`${domain}/api/roles-groups`, {
    method: checked ? 'POST' : 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}


// Creates a role in the database when the text is entered
async function createRole() {
  const roleName = document.getElementById('create-role').value.trim();
  if (!roleName) return;
  // API fetcj call that takes the text input and creates a role instance matching it 
  await fetch(`${domain}/api/roles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role_name: roleName })
  });

  document.getElementById('create-role').value = '';
  loadData();
}


// Function that makes an api call and deletes the role
async function deleteRole(roleName) {
  await fetch(`${domain}/api/roles/${roleName}`, { method: 'DELETE' });
  loadData();
}
